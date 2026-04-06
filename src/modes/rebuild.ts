/**
 * Rebuild Mode — faithfully mirror an existing website as static HTML.
 * Downloads all pages, CSS, JS, images, and fonts with correct paths.
 * No LLM involved — just a straight copy for local hosting.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright'
import * as fs from 'fs/promises'
import * as path from 'path'

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
  const downloadedAssets = new Set<string>()
  const pageFiles: string[] = []
  const errors: string[] = []

  await fs.mkdir(outputDir, { recursive: true })

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    while (toVisit.length > 0 && visited.size < maxPages) {
      const currentUrl = toVisit.shift()!
      const normalized = normalizeUrl(currentUrl, baseUrl)

      if (visited.has(normalized)) continue
      visited.add(normalized)

      console.log(`  Crawling [${visited.size}/${maxPages}]: ${currentUrl}`)

      try {
        const page = await context.newPage()

        // Intercept and download all assets (CSS, JS, images, fonts)
        page.on('response', async (response) => {
          try {
            const url = response.url()
            const contentType = response.headers()['content-type'] || ''

            // Only download assets from same origin or CDNs
            if (isAsset(url, contentType) && !downloadedAssets.has(url)) {
              downloadedAssets.add(url)
              const body = await response.body().catch(() => null)
              if (body) {
                const assetPath = urlToLocalPath(url, baseUrl)
                const fullPath = path.join(outputDir, assetPath)
                await fs.mkdir(path.dirname(fullPath), { recursive: true })
                await fs.writeFile(fullPath, body)
              }
            }
          } catch {
            // Silently skip asset download failures
          }
        })

        await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(1500) // Let lazy content load

        // Get the full rendered HTML
        let html = await page.content()

        // Rewrite asset URLs to local paths
        html = rewriteUrls(html, baseUrl)

        // Determine local file path
        const urlPath = new URL(currentUrl).pathname
        const localPath = urlPathToFilePath(urlPath)
        const fullPath = path.join(outputDir, localPath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, html, 'utf-8')
        pageFiles.push(localPath)

        // Discover internal links
        const links = await page.evaluate((origin) => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.getAttribute('href'))
            .filter(Boolean) as string[]
        }, baseUrl.origin)

        for (const href of links) {
          try {
            const resolved = new URL(href, currentUrl)
            if (resolved.hostname === baseUrl.hostname) {
              const norm = normalizeUrl(resolved.href, baseUrl)
              if (!visited.has(norm)) {
                toVisit.push(resolved.href)
              }
            }
          } catch {
            // Skip invalid URLs
          }
        }

        await page.close()
      } catch (err) {
        errors.push(`Failed to crawl ${currentUrl}: ${(err as Error).message}`)
      }
    }
  } finally {
    if (browser) await browser.close()
  }

  console.log(`  Downloaded ${downloadedAssets.size} assets`)
  console.log(`  Saved ${pageFiles.length} pages`)

  return { pages: pageFiles, assets: downloadedAssets.size, errors }
}

/** Normalize a URL for deduplication */
function normalizeUrl(url: string, baseUrl: URL): string {
  try {
    const u = new URL(url)
    // Remove hash, trailing slash, normalize
    let pathname = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.hostname}${pathname}`
  } catch {
    return url
  }
}

/** Check if a response is a downloadable asset */
function isAsset(url: string, contentType: string): boolean {
  const ext = path.extname(new URL(url).pathname).toLowerCase()
  const assetExts = [
    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp4', '.webm', '.pdf',
  ]
  if (assetExts.includes(ext)) return true

  const assetTypes = ['text/css', 'application/javascript', 'image/', 'font/', 'video/', 'application/pdf']
  return assetTypes.some(t => contentType.includes(t))
}

/** Convert an absolute URL to a local file path */
function urlToLocalPath(url: string, baseUrl: URL): string {
  const u = new URL(url)

  // Same origin — use the pathname
  if (u.hostname === baseUrl.hostname) {
    let p = u.pathname
    if (p === '/' || p === '') p = '/index.html'
    return p.replace(/^\//, '')
  }

  // External CDN — put in _external/{hostname}/
  let p = u.pathname
  if (p === '/' || p === '') p = '/index'
  return path.join('_external', u.hostname, p.replace(/^\//, ''))
}

/** Convert a URL path to a local file path (for HTML pages) */
function urlPathToFilePath(urlPath: string): string {
  let p = urlPath.replace(/\/+$/, '') || '/'
  if (p === '/') return 'index.html'
  // If it already has an extension, keep it
  if (path.extname(p)) return p.replace(/^\//, '')
  // Otherwise treat as directory → index.html
  return p.replace(/^\//, '') + '/index.html'
}

/** Rewrite absolute URLs in HTML to relative local paths */
function rewriteUrls(html: string, baseUrl: URL): string {
  const origin = baseUrl.origin

  // Rewrite same-origin absolute URLs to relative paths
  // href="https://example.com/about" → href="./about/"
  // src="https://example.com/images/logo.png" → src="./images/logo.png"
  html = html.replace(
    new RegExp(`(href|src|action)=["']${escapeRegex(origin)}(/[^"']*?)["']`, 'gi'),
    (_, attr, urlPath) => {
      const localPath = urlPath.replace(/^\//, './')
      return `${attr}="${localPath}"`
    }
  )

  // Rewrite protocol-relative same-origin URLs
  html = html.replace(
    new RegExp(`(href|src)=["']//${escapeRegex(baseUrl.hostname)}(/[^"']*?)["']`, 'gi'),
    (_, attr, urlPath) => {
      const localPath = urlPath.replace(/^\//, './')
      return `${attr}="${localPath}"`
    }
  )

  // Rewrite root-relative URLs (starting with /)
  // But not protocol-relative (//)
  html = html.replace(
    /(href|src|action)=["']\/(?!\/)/gi,
    '$1="./'
  )

  // Rewrite external CDN URLs to _external/ paths
  html = html.replace(
    /(href|src)=["']https?:\/\/([^"']+?)["']/gi,
    (match, attr, rest) => {
      const fullUrl = rest.startsWith('//') ? `https:${rest}` : `https://${rest}`
      try {
        const u = new URL(`https://${rest}`)
        if (u.hostname === baseUrl.hostname) return match // Already handled
        const localPath = `./_external/${u.hostname}${u.pathname}`
        return `${attr}="${localPath}"`
      } catch {
        return match
      }
    }
  )

  return html
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
