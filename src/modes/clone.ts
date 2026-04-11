/**
 * Clone Mode — extract layout from an inspiration site,
 * extract content from the client's existing site,
 * then merge: inspiration layout + client content.
 */

import { chromium, type Browser, type Page } from 'playwright'
import OpenAI from 'openai'
import * as fs from 'fs/promises'
import * as path from 'path'
import { tokenTracker } from '../token-tracker.js'

// Workaround for tsx/esbuild __name issue
const safeEval = (page: Page, code: string): Promise<any> =>
  page.evaluate(`(function(){${code}})()`)

let _client: OpenAI | null = null
const getClient = (): OpenAI => {
  if (!_client) _client = new OpenAI()
  return _client
}

export interface CloneInput {
  clientUrl?: string            // URL of client's existing site (to extract content)
  inspirationUrl: string        // URL of site to clone layout from
  businessName: string
  description: string
  industry?: string
  phone?: string
  email?: string
  address?: string
  logoUrl?: string
  logoReverseUrl?: string
  faviconUrl?: string
  maxPages?: number
}

export interface CloneResult {
  pages: string[]
  assets: number
  errors: string[]
}

export async function clone(input: CloneInput, outputDir: string): Promise<CloneResult> {
  const errors: string[] = []
  const maxPages = input.maxPages || 10
  const assetMap = new Map<string, string>()
  const downloadedAssets = new Set<string>()

  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(path.join(outputDir, 'assets', 'images'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'assets', 'fonts'), { recursive: true })

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    })

    // ── Step 1: Extract layout from inspiration site ──────────────
    console.log(`[Clone] Crawling inspiration site: ${input.inspirationUrl}`)
    const inspirationLayouts = await crawlLayouts(context, input.inspirationUrl, maxPages)
    console.log(`[Clone] Extracted ${inspirationLayouts.length} page layouts`)

    // ── Step 2: Extract content from client's site (if provided) ──
    let clientContent: PageContent[] = []
    if (input.clientUrl) {
      console.log(`[Clone] Crawling client site: ${input.clientUrl}`)
      clientContent = await crawlContent(context, input.clientUrl, maxPages)
      console.log(`[Clone] Extracted content from ${clientContent.length} pages`)
    }

    // ── Step 3: Extract CSS from inspiration site ──────────────────
    console.log(`[Clone] Extracting design from inspiration...`)
    const inspPage = await context.newPage()

    // Capture raw CSS file URLs during page load
    const cssFileUrls: string[] = []
    inspPage.on('response', async (response) => {
      const ct = response.headers()['content-type'] || ''
      if (ct.includes('text/css') || response.url().endsWith('.css')) {
        cssFileUrls.push(response.url())
      }
    })

    await inspPage.goto(input.inspirationUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await inspPage.waitForTimeout(2000)

    // Try computed CSS first, fall back to downloading raw CSS files
    let inspirationCss = await extractComputedCss(inspPage)
    if (!inspirationCss || inspirationCss.trim().length < 100) {
      console.log(`  Computed CSS extraction limited, downloading ${cssFileUrls.length} CSS files...`)
      const cssParts: string[] = []
      for (const cssUrl of cssFileUrls) {
        try {
          const resp = await fetch(cssUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)' },
            signal: AbortSignal.timeout(10000),
          })
          if (resp.ok) cssParts.push(await resp.text())
        } catch { }
      }
      inspirationCss = cssParts.join('\n\n')
    }

    // Also grab inline styles
    const inlineStyles = await safeEval(inspPage, `
      var styles = [];
      document.querySelectorAll('style').forEach(function(s) { styles.push(s.textContent); });
      return styles.join('\\n');
    `) as string
    if (inlineStyles) inspirationCss = inlineStyles + '\n\n' + inspirationCss

    const rootAttrs = await extractRootAttrs(inspPage)

    // Download inspiration images
    const inspImages = await extractImageUrls(inspPage)
    await inspPage.close()

    for (const imgUrl of inspImages) {
      await downloadAsset(imgUrl, input.inspirationUrl, outputDir, downloadedAssets, assetMap)
    }

    // ── Step 4: Generate pages — merge layout + content via LLM ───
    const pageFiles: string[] = []
    const businessInfo = {
      name: input.businessName,
      description: input.description,
      industry: input.industry || '',
      phone: input.phone || '',
      email: input.email || '',
      address: input.address || '',
      logoUrl: input.logoUrl || '',
      faviconUrl: input.faviconUrl || '',
    }

    // Generate shared nav + footer first
    console.log(`[Clone] Generating nav & footer...`)
    const shellHtml = await generateShell(inspirationLayouts[0], businessInfo)

    for (let i = 0; i < inspirationLayouts.length; i++) {
      const layout = inspirationLayouts[i]
      const content = clientContent[i] || clientContent[0] || null
      const pageType = guessPageType(layout.path)

      console.log(`  Generating page: ${layout.path}`)

      try {
        const mainHtml = await generateClonedPage(layout, content, businessInfo, pageType)

        // Rewrite asset URLs
        let finalHtml = mainHtml
        for (const [origUrl, localPath] of assetMap) {
          finalHtml = finalHtml.split(origUrl).join(localPath)
        }

        // First page is always the homepage (index.html at root)
        const filePath = i === 0 ? 'index.html' : `${layout.path.replace(/^\//, '').replace(/\/$/, '')}/index.html`
        const depth = filePath.split('/').length - 1
        const cssRelPath = depth === 0 ? './styles.css' : '../'.repeat(depth) + 'styles.css'

        const fullHtml = wrapPage(shellHtml, finalHtml, cssRelPath, businessInfo, rootAttrs)
        const fullPath = path.join(outputDir, filePath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, fullHtml, 'utf-8')
        pageFiles.push(filePath)
      } catch (err) {
        errors.push(`Failed ${layout.path}: ${(err as Error).message}`)
      }
    }

    // ── Step 5: Download CSS-referenced assets & write stylesheet ──
    console.log(`[Clone] Downloading CSS assets...`)
    const cssUrls = extractUrlsFromCss(inspirationCss)
    for (const url of cssUrls) {
      await downloadAsset(url, input.inspirationUrl, outputDir, downloadedAssets, assetMap)
    }

    let finalCss = inspirationCss
    for (const [origUrl, localPath] of assetMap) {
      const escaped = origUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      finalCss = finalCss.replace(new RegExp(escaped, 'g'), localPath)
    }
    await fs.writeFile(path.join(outputDir, 'styles.css'), finalCss, 'utf-8')

  } finally {
    if (browser) await browser.close()
  }

  console.log(`[Clone] Done! ${downloadedAssets.size} assets, errors: ${errors.length}`)
  tokenTracker.printSummary()

  return { pages: [], assets: downloadedAssets.size, errors }
}

// ── Types ──────────────────────────────────────────────

interface PageLayout {
  path: string
  sections: string[]  // HTML of each major section (stripped of text content)
  sectionTypes: string[]  // hero, features, testimonials, cta, etc.
  navHtml: string
  footerHtml: string
}

interface PageContent {
  path: string
  title: string
  headings: string[]
  paragraphs: string[]
  listItems: string[]
  images: string[]
  meta: { title: string; description: string }
}

// ── Crawl layout structure from inspiration ──────────────

async function crawlLayouts(
  context: any,
  startUrl: string,
  maxPages: number
): Promise<PageLayout[]> {
  const baseUrl = new URL(startUrl)
  const visited = new Set<string>()
  const toVisit = [startUrl]
  const layouts: PageLayout[] = []

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift()!
    const norm = normalizeUrl(url, baseUrl)
    if (visited.has(norm)) continue
    visited.add(norm)

    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1500)

      const layout = await safeEval(page, `
        // Extract section structure
        var sections = [];
        var sectionTypes = [];
        var mainEl = document.querySelector('main') || document.body;

        // Find all top-level sections/divs
        var candidates = mainEl.querySelectorAll('section, [class*="hero"], [class*="banner"], [class*="features"], [class*="services"], [class*="testimonial"], [class*="cta"], [class*="contact"], [class*="about"], [class*="team"], [class*="pricing"], [class*="faq"], [class*="gallery"]');
        if (candidates.length === 0) {
          candidates = mainEl.children;
        }

        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NAV' || el.tagName === 'FOOTER' || el.tagName === 'HEADER') continue;

          // Get the HTML skeleton (keep classes and structure, abbreviate text)
          var clone = el.cloneNode(true);
          // Replace long text with placeholders
          var textNodes = [];
          var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) textNodes.push(walker.currentNode);
          textNodes.forEach(function(n) {
            if (n.textContent.trim().length > 50) n.textContent = '[CONTENT]';
          });

          sections.push(clone.outerHTML.substring(0, 3000));

          // Guess section type from classes/content
          var cls = (el.className || '').toString().toLowerCase();
          var type = 'generic';
          if (cls.match(/hero|banner|masthead|jumbotron/)) type = 'hero';
          else if (cls.match(/feature|service|offering/)) type = 'features';
          else if (cls.match(/testimonial|review|quote/)) type = 'testimonials';
          else if (cls.match(/cta|call.to.action|action/)) type = 'cta';
          else if (cls.match(/contact|form/)) type = 'contact';
          else if (cls.match(/about|story|mission/)) type = 'about';
          else if (cls.match(/team|staff|people/)) type = 'team';
          else if (cls.match(/pricing|plan|package/)) type = 'pricing';
          else if (cls.match(/faq|question|accordion/)) type = 'faq';
          else if (cls.match(/gallery|portfolio|project/)) type = 'gallery';
          else if (cls.match(/stat|counter|number/)) type = 'stats';
          else if (i === 0) type = 'hero';
          sectionTypes.push(type);
        }

        // Get nav and footer
        var navEl = document.querySelector('nav, header, [class*="header"], [class*="navbar"]');
        var footerEl = document.querySelector('footer, [class*="footer"]');

        return {
          sections: sections,
          sectionTypes: sectionTypes,
          navHtml: navEl ? navEl.outerHTML.substring(0, 2000) : '',
          footerHtml: footerEl ? footerEl.outerHTML.substring(0, 2000) : ''
        };
      `) as { sections: string[]; sectionTypes: string[]; navHtml: string; footerHtml: string }

      const urlPath = new URL(url).pathname
      layouts.push({
        path: urlPath === '' ? '/' : urlPath,
        ...layout,
      })

      // Discover internal links
      const links = await safeEval(page, `
        return Array.from(document.querySelectorAll('a[href]'))
          .map(function(a) { return a.getAttribute('href'); })
          .filter(Boolean);
      `) as string[]

      for (const href of links) {
        try {
          const resolved = new URL(href, url)
          if (resolved.hostname === baseUrl.hostname && !visited.has(normalizeUrl(resolved.href, baseUrl))) {
            toVisit.push(resolved.href)
          }
        } catch { }
      }
    } catch (err) {
      console.log(`  Failed to crawl ${url}: ${(err as Error).message}`)
    } finally {
      await page.close()
    }
  }

  return layouts
}

// ── Crawl content from client's site ──────────────────────

async function crawlContent(
  context: any,
  startUrl: string,
  maxPages: number
): Promise<PageContent[]> {
  const baseUrl = new URL(startUrl)
  const visited = new Set<string>()
  const toVisit = [startUrl]
  const contents: PageContent[] = []

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift()!
    const norm = normalizeUrl(url, baseUrl)
    if (visited.has(norm)) continue
    visited.add(norm)

    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1000)

      const content = await safeEval(page, `
        var headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(function(h) { return h.textContent.trim(); });
        var paragraphs = Array.from(document.querySelectorAll('p')).map(function(p) { return p.textContent.trim(); }).filter(function(t) { return t.length > 20; });
        var listItems = Array.from(document.querySelectorAll('li')).map(function(li) { return li.textContent.trim(); }).filter(function(t) { return t.length > 10 && t.length < 200; });
        var images = Array.from(document.querySelectorAll('img[src]')).map(function(img) { return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' }; });
        var title = document.title || '';
        var metaDesc = (document.querySelector('meta[name="description"]') || {}).content || '';

        return {
          title: title,
          headings: headings.slice(0, 20),
          paragraphs: paragraphs.slice(0, 30),
          listItems: listItems.slice(0, 20),
          images: images.slice(0, 15).map(function(i) { return i.src; }),
          meta: { title: title, description: metaDesc }
        };
      `) as Omit<PageContent, 'path'>

      contents.push({ path: new URL(url).pathname || '/', ...content })

      // Discover links
      const links = await safeEval(page, `
        return Array.from(document.querySelectorAll('a[href]'))
          .map(function(a) { return a.getAttribute('href'); })
          .filter(Boolean);
      `) as string[]

      for (const href of links) {
        try {
          const resolved = new URL(href, url)
          if (resolved.hostname === baseUrl.hostname && !visited.has(normalizeUrl(resolved.href, baseUrl))) {
            toVisit.push(resolved.href)
          }
        } catch { }
      }
    } catch { } finally {
      await page.close()
    }
  }

  return contents
}

// ── Generate merged page via LLM ──────────────────────────

async function generateShell(layout: PageLayout, business: Record<string, string>): Promise<{ nav: string; footer: string }> {
  const response = await getClient().chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Create a navigation and footer for a website. Use the layout structure below as inspiration for the HTML structure, but replace all content with the business details provided.

INSPIRATION NAV STRUCTURE:
${layout.navHtml}

INSPIRATION FOOTER STRUCTURE:
${layout.footerHtml}

BUSINESS NAME: ${business.name}
DESCRIPTION: ${business.description}
PHONE: ${business.phone}
EMAIL: ${business.email}
ADDRESS: ${business.address}
${business.logoUrl ? `LOGO: <img src="${business.logoUrl}" alt="${business.name}" style="height:2.2rem;">` : ''}

Return a JSON object (no markdown):
{ "nav": "<nav>...complete nav HTML...</nav>", "footer": "<footer>...complete footer HTML...</footer>" }

Keep the same structural pattern (classes, nesting, grid) from the inspiration, but swap in the business content. Use Font Awesome icons where appropriate.`,
    }],
  })

  tokenTracker.track('Nav & Footer', {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })

  const raw = response.choices[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '')
    return JSON.parse(cleaned)
  } catch {
    return { nav: `<nav>${business.name}</nav>`, footer: `<footer>${business.name}</footer>` }
  }
}

async function generateClonedPage(
  layout: PageLayout,
  content: PageContent | null,
  business: Record<string, string>,
  pageType: string,
): Promise<string> {
  const sectionsGuide = layout.sections.map((html, i) => {
    return `SECTION ${i + 1} (type: ${layout.sectionTypes[i]}):\n${html.substring(0, 1500)}`
  }).join('\n\n')

  const contentGuide = content
    ? `
CLIENT CONTENT TO USE:
Headings: ${content.headings.join(' | ')}
Key paragraphs: ${content.paragraphs.slice(0, 10).join('\n')}
List items: ${content.listItems.slice(0, 10).join(' | ')}
`
    : `
No client content provided. Generate professional content for a ${business.industry || 'business'} called "${business.name}".
Description: ${business.description}
`

  const response = await getClient().chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 12000,
    messages: [{
      role: 'user',
      content: `Generate the main content (no nav, no footer, no <html>/<head>) for a ${pageType} page.

BUSINESS: ${business.name}
INDUSTRY: ${business.industry}

LAYOUT STRUCTURE TO FOLLOW (replicate this section arrangement and HTML structure):
${sectionsGuide}

${contentGuide}

Requirements:
- Follow the EXACT section arrangement from the layout above
- Keep the same class names and HTML nesting pattern
- Replace placeholder content with the business content
- Use Font Awesome icons where the layout has icons
- Hero sections should use background images: style="background-image: url('https://picsum.photos/seed/${(business.industry || 'business').replace(/[^a-z]/gi, '-')}/1600/800'); background-size: cover; background-position: center;"
- Include a dark overlay div for hero sections
- Use Picsum for other images: https://picsum.photos/seed/{keyword}/{width}/{height}
- Every section must wrap content in a container/wrapper div
- Use the business phone, email, address where appropriate
${business.logoUrl ? `- Logo: <img src="${business.logoUrl}" alt="${business.name}">` : ''}

Return ONLY the HTML content, no explanation.`,
    }],
  })

  tokenTracker.track(`Page: ${layout.path}`, {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })

  let html = response.choices[0]?.message?.content || ''
  return html.replace(/^```html?\n?/m, '').replace(/\n?```$/m, '')
}

// ── Helper functions ──────────────────────────────────────

function wrapPage(
  shell: { nav: string; footer: string },
  mainHtml: string,
  cssPath: string,
  business: Record<string, string>,
  rootAttrs: { html: Record<string, string>; body: Record<string, string> }
): string {
  const htmlAttrStr = Object.entries(rootAttrs.html || { lang: 'en' })
    .map(([k, v]) => `${k}="${v}"`).join(' ')

  return `<!DOCTYPE html>
<html ${htmlAttrStr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${business.name}</title>
  ${business.faviconUrl ? `<link rel="icon" href="${business.faviconUrl}">` : ''}
  <link rel="stylesheet" href="${cssPath}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body>
${shell.nav}
<main>
${mainHtml}
</main>
${shell.footer}
</body>
</html>`
}

async function extractComputedCss(page: Page): Promise<string> {
  return await safeEval(page, `
    var usedRules = [];
    var seen = {};
    var skipPatterns = ['#wpadminbar','.ab-top-menu','wp-emoji','wp-json','.logged-in','.admin-bar','.screen-reader-text'];

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
                if (sel && !seen[sel] && !skipPatterns.some(function(p){return sel.indexOf(p)>=0})) {
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
            if (sel2 && !seen[sel2] && !skipPatterns.some(function(p){return sel2.indexOf(p)>=0})) {
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

async function extractRootAttrs(page: Page): Promise<{ html: Record<string, string>; body: Record<string, string> }> {
  return await safeEval(page, `
    var getAttrs = function(el) {
      var result = {};
      for (var i = 0; i < el.attributes.length; i++) {
        var a = el.attributes[i];
        result[a.name] = a.value;
      }
      return result;
    };
    return { html: getAttrs(document.documentElement), body: getAttrs(document.body) };
  `)
}

async function extractImageUrls(page: Page): Promise<string[]> {
  return await safeEval(page, `
    var urls = [];
    var seen = {};
    document.querySelectorAll('img[src]').forEach(function(img) {
      var src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !seen[src]) { seen[src]=1; urls.push(src); }
    });
    document.querySelectorAll('section, div, header, footer').forEach(function(el) {
      var bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        var re = /url\\(["']?([^"'\\)]+)["']?\\)/g;
        var m;
        while ((m = re.exec(bg)) !== null) {
          if (!m[1].startsWith('data:') && !seen[m[1]]) { seen[m[1]]=1; urls.push(m[1]); }
        }
      }
    });
    return urls;
  `) as string[]
}

async function downloadAsset(
  url: string,
  baseUrl: string,
  outputDir: string,
  downloaded: Set<string>,
  assetMap: Map<string, string>
): Promise<void> {
  try {
    const absoluteUrl = new URL(url, baseUrl).href
    if (downloaded.has(absoluteUrl)) return
    downloaded.add(absoluteUrl)

    const response = await fetch(absoluteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return

    const buffer = Buffer.from(await response.arrayBuffer())
    const ext = guessExtension(absoluteUrl, response.headers.get('content-type'))
    const filename = sanitizeFilename(absoluteUrl) + ext
    const isFont = /\.(woff2?|ttf|otf|eot)$/i.test(ext)
    const localPath = `assets/${isFont ? 'fonts' : 'images'}/${filename}`
    await fs.writeFile(path.join(outputDir, localPath), buffer)
    assetMap.set(absoluteUrl, localPath)
    assetMap.set(url, localPath)
  } catch { }
}

function extractUrlsFromCss(css: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const re = /url\(['"]?([^'")\s]+?)['"]?\)/gi
  let m
  while ((m = re.exec(css)) !== null) {
    if (!m[1].startsWith('data:') && !m[1].startsWith('assets/') && !seen.has(m[1])) {
      seen.add(m[1])
      urls.push(m[1])
    }
  }
  return urls
}

function normalizeUrl(url: string, baseUrl: URL): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, '') || '/'}`
  } catch { return url }
}

function guessPageType(urlPath: string): string {
  const p = urlPath.toLowerCase()
  if (p === '/' || p === '') return 'homepage'
  if (p.includes('about')) return 'about'
  if (p.includes('service')) return 'services'
  if (p.includes('contact')) return 'contact'
  if (p.includes('blog') || p.includes('news')) return 'blog'
  if (p.includes('faq')) return 'faq'
  if (p.includes('team')) return 'team'
  if (p.includes('pricing') || p.includes('plan')) return 'pricing'
  if (p.includes('gallery') || p.includes('portfolio')) return 'gallery'
  if (p.includes('product')) return 'products'
  return 'generic'
}

function guessExtension(url: string, contentType: string | null): string {
  const ext = path.extname(new URL(url).pathname).split('?')[0]
  if (ext && ext.length <= 5) return ext
  if (contentType?.includes('webp')) return '.webp'
  if (contentType?.includes('png')) return '.png'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg'
  if (contentType?.includes('svg')) return '.svg'
  if (contentType?.includes('woff2')) return '.woff2'
  if (contentType?.includes('woff')) return '.woff'
  return '.bin'
}

function sanitizeFilename(url: string): string {
  const basename = path.basename(new URL(url).pathname, path.extname(new URL(url).pathname))
  return basename.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'asset'
}
