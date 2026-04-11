/**
 * Rebuild Mode — recreate an existing website as clean, lightweight static HTML.
 *
 * 1. Crawls all pages with Playwright
 * 2. Extracts only the used CSS (computed styles, not full WordPress stylesheets)
 * 3. Strips WordPress bloat: admin bar, wp-emoji, jQuery, tracking scripts, comments
 * 4. Downloads images and fonts locally
 * 5. Produces clean HTML + a single clean stylesheet
 */

import { chromium, type Browser, type Page } from 'playwright'
import * as fs from 'fs/promises'
import * as path from 'path'

// Workaround for tsx/esbuild injecting __name into page.evaluate
// We use page.evaluate with string expressions instead of functions
const safeEval = (page: Page, code: string): Promise<any> =>
  page.evaluate(`(function(){${code}})()`)

export interface RebuildResult {
  pages: string[]
  assets: number
  errors: string[]
}

export async function rebuild(
  input: { url: string; maxPages?: number },
  outputDir: string
): Promise<RebuildResult> {
  const baseUrl = new URL(input.url)
  const maxPages = input.maxPages || 50
  const visited = new Set<string>()
  const toVisit: string[] = [input.url]
  const pageFiles: string[] = []
  const errors: string[] = []
  const downloadedAssets = new Set<string>()
  const assetMap = new Map<string, string>() // original URL → local path

  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(path.join(outputDir, 'assets', 'images'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'assets', 'fonts'), { recursive: true })

  let browser: Browser | null = null
  let globalCss = ''

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    })

    // First pass: extract used CSS from homepage
    console.log('  Extracting used CSS from homepage...')
    const cssPage = await context.newPage()
    try {
      await cssPage.goto(input.url, { waitUntil: 'networkidle', timeout: 30000 })
      await cssPage.waitForTimeout(2000)
      globalCss = await extractUsedCss(cssPage, baseUrl)
    } finally {
      await cssPage.close()
    }

    // Crawl all pages
    while (toVisit.length > 0 && visited.size < maxPages) {
      const currentUrl = toVisit.shift()!
      const normalized = normalizeUrl(currentUrl, baseUrl)

      if (visited.has(normalized)) continue
      visited.add(normalized)

      console.log(`  Crawling [${visited.size}/${maxPages}]: ${currentUrl}`)

      const page = await context.newPage()

      try {
        await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(1500)

        // Extract and merge any page-specific CSS not in the global set
        if (visited.size <= 5) {
          const pageCss = await extractUsedCss(page, baseUrl)
          globalCss = mergeCss(globalCss, pageCss)
        }

        // Capture html and body attributes before cleaning
        const rootAttrs = await safeEval(page, `
          var htmlEl = document.documentElement;
          var bodyEl = document.body;
          var getAttrs = function(el) {
            var result = {};
            for (var i = 0; i < el.attributes.length; i++) {
              var a = el.attributes[i];
              if (a.name !== 'class' || (a.value && a.value.indexOf('logged-in') === -1)) {
                result[a.name] = a.value;
              }
            }
            return result;
          };
          return { html: getAttrs(htmlEl), body: getAttrs(bodyEl) };
        `) as { html: Record<string, string>; body: Record<string, string> }

        // Extract clean HTML
        const cleanHtml = await extractCleanHtml(page, baseUrl)

        // Find all image/font URLs to download
        const assetUrls = await safeEval(page, `
          var urls = [];
          document.querySelectorAll('img[src]').forEach(function(img) {
            var src = img.getAttribute('src');
            if (src && !src.startsWith('data:')) urls.push({ url: src, type: 'image' });
          });
          document.querySelectorAll('img[srcset], source[srcset]').forEach(function(el) {
            var srcset = el.getAttribute('srcset') || '';
            srcset.split(',').forEach(function(entry) {
              var url = entry.trim().split(/\\s+/)[0];
              if (url && !url.startsWith('data:')) urls.push({ url: url, type: 'image' });
            });
          });
          document.querySelectorAll('[style]').forEach(function(el) {
            var style = el.getAttribute('style') || '';
            var match = style.match(/url\\(['"]?([^'"\\)\\s]+)['"]?\\)/i);
            if (match && !match[1].startsWith('data:')) urls.push({ url: match[1], type: 'image' });
          });
          document.querySelectorAll('section, div, header, footer, main').forEach(function(el) {
            var computed = getComputedStyle(el);
            var bg = computed.backgroundImage;
            if (bg && bg !== 'none') {
              var re = /url\\(["']?([^"'\\)]+)["']?\\)/g;
              var m;
              while ((m = re.exec(bg)) !== null) {
                if (!m[1].startsWith('data:')) urls.push({ url: m[1], type: 'image' });
              }
            }
          });
          return urls;
        `) as { url: string; type: string }[]

        // Download assets
        for (const asset of assetUrls) {
          try {
            const absoluteUrl = new URL(asset.url, currentUrl).href
            if (downloadedAssets.has(absoluteUrl)) continue
            downloadedAssets.add(absoluteUrl)

            const response = await fetch(absoluteUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)' },
              signal: AbortSignal.timeout(10000),
            })
            if (!response.ok) continue

            const buffer = Buffer.from(await response.arrayBuffer())
            const ext = guessExtension(absoluteUrl, response.headers.get('content-type'))
            const filename = sanitizeFilename(absoluteUrl) + ext
            const localPath = `assets/images/${filename}`
            await fs.writeFile(path.join(outputDir, localPath), buffer)
            assetMap.set(absoluteUrl, localPath)
            // Also map the original (possibly relative) URL
            assetMap.set(asset.url, localPath)
          } catch {
            // Skip failed downloads
          }
        }

        // Rewrite image URLs in the clean HTML to local paths
        let finalHtml = cleanHtml
        for (const [originalUrl, localPath] of assetMap) {
          const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          finalHtml = finalHtml.replace(new RegExp(escaped, 'g'), localPath)
        }

        // Determine file path
        const urlPath = new URL(currentUrl).pathname
        const localFilePath = urlPathToFilePath(urlPath)
        const depth = localFilePath.split('/').length - 1
        const cssRelPath = depth === 0 ? './styles.css' : '../'.repeat(depth) + 'styles.css'

        // Wrap in a full HTML document with local stylesheet link
        const fullHtml = buildFullPage(finalHtml, cssRelPath, currentUrl, baseUrl, rootAttrs)
        const fullPath = path.join(outputDir, localFilePath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, fullHtml, 'utf-8')
        pageFiles.push(localFilePath)

        // Discover internal links
        const links = await safeEval(page, `
          return Array.from(document.querySelectorAll('a[href]'))
            .map(function(a) { return a.getAttribute('href'); })
            .filter(Boolean);
        `) as string[]

        for (const href of links) {
          try {
            const resolved = new URL(href, currentUrl)
            if (resolved.hostname === baseUrl.hostname) {
              const norm = normalizeUrl(resolved.href, baseUrl)
              if (!visited.has(norm) && !resolved.pathname.match(/\.(pdf|zip|doc|xls|png|jpg|gif|svg)$/i)) {
                toVisit.push(resolved.href)
              }
            }
          } catch { }
        }
      } catch (err) {
        errors.push(`Failed: ${currentUrl}: ${(err as Error).message}`)
      } finally {
        await page.close()
      }
    }
  } finally {
    if (browser) await browser.close()
  }

  // Download all images and fonts referenced in CSS
  console.log('  Downloading CSS-referenced assets...')
  const cssUrls = extractAllCssUrls(globalCss)
  for (const cssUrl of cssUrls) {
    try {
      const absoluteUrl = new URL(cssUrl, input.url).href
      if (downloadedAssets.has(absoluteUrl)) continue
      downloadedAssets.add(absoluteUrl)

      const response = await fetch(absoluteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) continue

      const buffer = Buffer.from(await response.arrayBuffer())
      const ext = guessExtension(absoluteUrl, response.headers.get('content-type'))
      const filename = sanitizeFilename(absoluteUrl) + ext
      const isFont = /\.(woff2?|ttf|otf|eot)$/i.test(ext)
      const subdir = isFont ? 'assets/fonts' : 'assets/images'
      const localPath = `${subdir}/${filename}`
      await fs.writeFile(path.join(outputDir, localPath), buffer)
      assetMap.set(absoluteUrl, localPath)
      assetMap.set(cssUrl, localPath)
    } catch {
      // Skip failed downloads
    }
  }

  // Rewrite all URLs in the CSS to local paths
  let finalCss = globalCss
  for (const [originalUrl, localPath] of assetMap) {
    const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    finalCss = finalCss.replace(new RegExp(escaped, 'g'), localPath)
  }

  // Write the single clean stylesheet
  await fs.writeFile(path.join(outputDir, 'styles.css'), finalCss, 'utf-8')

  console.log(`  Downloaded ${downloadedAssets.size} assets`)
  console.log(`  Saved ${pageFiles.length} pages`)
  console.log(`  Generated styles.css (${Math.round(finalCss.length / 1024)}KB)`)

  return { pages: pageFiles, assets: downloadedAssets.size, errors }
}

/**
 * Extract only the CSS rules that are actually used on the page.
 * Uses the browser's computed styles rather than raw stylesheets.
 */
async function extractUsedCss(page: Page, baseUrl: URL): Promise<string> {
  return await safeEval(page, `
    var usedRules = [];
    var seen = {};
    var wpPatterns = ['#wpadminbar','.ab-top-menu','wp-emoji','wp-json','.logged-in','.admin-bar','.screen-reader-text'];

    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var sheet = document.styleSheets[i];
        var rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;

        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          if (rule instanceof CSSMediaRule) {
            var mediaRules = [];
            for (var k = 0; k < rule.cssRules.length; k++) {
              var inner = rule.cssRules[k];
              if (inner instanceof CSSStyleRule) {
                var sel = inner.selectorText;
                if (sel && !seen[sel] && !wpPatterns.some(function(p){return sel.indexOf(p)>=0})) {
                  try { if (document.querySelectorAll(sel).length > 0) { seen[sel]=1; mediaRules.push(inner.cssText); } } catch(e){}
                }
              }
            }
            if (mediaRules.length > 0) usedRules.push('@media ' + rule.conditionText + ' {\\n' + mediaRules.join('\\n') + '\\n}');
          } else if (rule instanceof CSSFontFaceRule) {
            usedRules.push(rule.cssText);
          } else if (rule instanceof CSSKeyframesRule) {
            usedRules.push(rule.cssText);
          } else if (rule instanceof CSSStyleRule) {
            var sel2 = rule.selectorText;
            if (sel2 && !seen[sel2] && !wpPatterns.some(function(p){return sel2.indexOf(p)>=0})) {
              try { if (document.querySelectorAll(sel2).length > 0) { seen[sel2]=1; usedRules.push(rule.cssText); } } catch(e){}
            }
          } else if (!(rule instanceof CSSImportRule)) {
            usedRules.push(rule.cssText);
          }
        }
      } catch(e) {}
    }
    return usedRules.join('\\n\\n');
  `) as string
}

/**
 * Extract clean HTML from the page — strips WordPress bloat.
 */
async function extractCleanHtml(page: Page, baseUrl: URL): Promise<string> {
  return await safeEval(page, `
    // Only remove elements that are genuinely bloat — keep ALL styling classes
    var removeSelectors = [
      '#wpadminbar',
      'script',
      'noscript',
      'link[rel="EditURI"]',
      'link[rel="wlwmanifest"]',
      'link[rel="pingback"]',
      'link[rel="stylesheet"]',
      'link[rel="preload"]',
      'link[rel="prefetch"]',
      'link[rel="dns-prefetch"]',
      'link[rel="preconnect"]',
      'style',
      'meta[name="generator"]',
      'iframe[src*="admin"]',
      'iframe[src*="googletagmanager"]',
      'iframe[src*="facebook"]'
    ];
    removeSelectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) { el.remove(); });
    });

    // Remove HTML comments
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    var comments = [];
    while (walk.nextNode()) comments.push(walk.currentNode);
    comments.forEach(function(c) { c.remove(); });

    // Remove only admin-bar class from body, keep everything else
    if (document.body.classList) {
      document.body.classList.remove('logged-in', 'admin-bar', 'no-js');
      document.body.classList.add('js');
    }

    return document.body.innerHTML;
  `) as string
}

/** Build a full HTML page with the clean content and local stylesheet */
function buildFullPage(
  bodyHtml: string,
  cssPath: string,
  pageUrl: string,
  baseUrl: URL,
  rootAttrs?: { html: Record<string, string>; body: Record<string, string> }
): string {
  const titleMatch = bodyHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  const title = titleMatch ? titleMatch[1].trim() : baseUrl.hostname

  // Reconstruct html and body attributes from original
  const htmlAttrs = rootAttrs?.html || {}
  if (!htmlAttrs.lang) htmlAttrs.lang = 'en'
  const htmlAttrStr = Object.entries(htmlAttrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')

  const bodyAttrs = rootAttrs?.body || {}
  // Remove logged-in/admin-bar from body classes
  if (bodyAttrs.class) {
    bodyAttrs.class = bodyAttrs.class
      .split(/\s+/)
      .filter(c => !['logged-in', 'admin-bar', 'no-js'].includes(c))
      .join(' ')
  }
  const bodyAttrStr = Object.entries(bodyAttrs)
    .filter(([_, v]) => v) // skip empty values
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')

  return `<!DOCTYPE html>
<html ${htmlAttrStr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="${cssPath}">
</head>
<body ${bodyAttrStr}>
${bodyHtml}
</body>
</html>`
}

/** Merge two CSS strings, deduplicating rules */
function mergeCss(existing: string, newCss: string): string {
  // Simple approach: just append new CSS that isn't already present
  const existingLines = new Set(existing.split('\n').map(l => l.trim()).filter(Boolean))
  const newLines = newCss.split('\n')
  const additions: string[] = []

  for (const line of newLines) {
    if (!existingLines.has(line.trim())) {
      additions.push(line)
    }
  }

  return existing + '\n' + additions.join('\n')
}

/** Extract ALL URLs from CSS text (images, fonts, SVGs) */
function extractAllCssUrls(css: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const regex = /url\(['"]?([^'")\s]+?)['"]?\)/gi
  let match
  while ((match = regex.exec(css)) !== null) {
    const url = match[1]
    // Skip data URIs and already-local paths
    if (url.startsWith('data:') || url.startsWith('assets/')) continue
    if (!seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }
  return urls
}

function normalizeUrl(url: string, baseUrl: URL): string {
  try {
    const u = new URL(url)
    let pathname = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.hostname}${pathname}`
  } catch {
    return url
  }
}

function urlPathToFilePath(urlPath: string): string {
  let p = urlPath.replace(/\/+$/, '') || '/'
  if (p === '/') return 'index.html'
  if (path.extname(p)) return p.replace(/^\//, '')
  return p.replace(/^\//, '') + '/index.html'
}

function guessExtension(url: string, contentType: string | null): string {
  const urlPath = new URL(url).pathname
  const urlExt = path.extname(urlPath).split('?')[0]
  if (urlExt && urlExt.length <= 5) return urlExt
  if (contentType?.includes('webp')) return '.webp'
  if (contentType?.includes('png')) return '.png'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg'
  if (contentType?.includes('svg')) return '.svg'
  if (contentType?.includes('gif')) return '.gif'
  if (contentType?.includes('woff2')) return '.woff2'
  if (contentType?.includes('woff')) return '.woff'
  if (contentType?.includes('ttf')) return '.ttf'
  return '.bin'
}

function sanitizeFilename(url: string): string {
  const urlPath = new URL(url).pathname
  const basename = path.basename(urlPath, path.extname(urlPath))
  return basename
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60)
    || 'asset'
}
