/**
 * Site Extractor — crawls a website using Playwright and extracts
 * everything needed to build a Blueprint: content, structure, design tokens, assets.
 */

import { chromium, type Page, type Browser } from 'playwright'
import * as cheerio from 'cheerio'
import type {
  SiteMeta,
  DesignTokens,
  PageBlueprint,
  SectionBlueprint,
  NavItem,
  AssetRef,
  PageSEO,
  SchemaSpec,
} from '../types/blueprint.js'

export interface CrawlResult {
  meta: SiteMeta
  design: DesignTokens
  pages: PageBlueprint[]
  navigation: NavItem[]
  assets: AssetRef[]
}

interface CrawlOptions {
  url: string
  maxPages?: number
  extractDesign?: boolean
}

export async function crawlAndExtract(options: CrawlOptions): Promise<CrawlResult> {
  const { url, maxPages = 20, extractDesign = true } = options
  const baseUrl = new URL(url)
  const visited = new Set<string>()
  const toVisit: string[] = [url]
  const pages: PageBlueprint[] = []
  const allAssets: AssetRef[] = []

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)',
    })

    let designTokens: DesignTokens | null = null
    let siteMeta: SiteMeta | null = null
    let navigation: NavItem[] = []

    while (toVisit.length > 0 && visited.size < maxPages) {
      const currentUrl = toVisit.shift()!
      const normalized = normalizeUrl(currentUrl)

      if (visited.has(normalized)) continue
      visited.add(normalized)

      console.log(`  Crawling [${visited.size}/${maxPages}]: ${currentUrl}`)

      const page = await context.newPage()

      try {
        await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(1000) // let lazy-loaded content appear

        const html = await page.content()
        const $ = cheerio.load(html)

        // Extract design tokens from first page only
        if (extractDesign && !designTokens) {
          designTokens = await extractDesignTokens(page)
        }

        // Extract site meta from first page
        if (!siteMeta) {
          siteMeta = extractSiteMeta($, baseUrl.origin)
        }

        // Extract navigation from first page
        if (navigation.length === 0) {
          navigation = extractNavigation($, baseUrl.origin)
        }

        // Extract page content
        const pageBlueprint = extractPageContent($, currentUrl, baseUrl.origin)
        pages.push(pageBlueprint)

        // Extract assets
        const pageAssets = extractAssets($, currentUrl)
        allAssets.push(...pageAssets)

        // Discover internal links
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href')
          if (!href) return
          try {
            const resolved = new URL(href, currentUrl)
            if (resolved.hostname === baseUrl.hostname && !visited.has(normalizeUrl(resolved.href))) {
              toVisit.push(resolved.href)
            }
          } catch {
            // skip invalid URLs
          }
        })
      } catch (err) {
        console.log(`  Failed to crawl ${currentUrl}: ${(err as Error).message}`)
      } finally {
        await page.close()
      }
    }

    return {
      meta: siteMeta || buildFallbackMeta(baseUrl.origin),
      design: designTokens || buildFallbackDesign(),
      pages,
      navigation,
      assets: deduplicateAssets(allAssets),
    }
  } finally {
    if (browser) await browser.close()
  }
}

/** Extract computed design tokens from the rendered page */
async function extractDesignTokens(page: Page): Promise<DesignTokens> {
  return page.evaluate(() => {
    const body = document.body
    const bodyStyle = getComputedStyle(body)
    const h1 = document.querySelector('h1')
    const h1Style = h1 ? getComputedStyle(h1) : null

    // Find primary color from buttons/links
    const button = document.querySelector('button, .btn, [class*="primary"], a.cta')
    const buttonStyle = button ? getComputedStyle(button) : null

    // Find accent from secondary buttons or highlighted elements
    const accent = document.querySelector('.accent, [class*="secondary"], [class*="highlight"]')
    const accentStyle = accent ? getComputedStyle(accent) : null

    return {
      colors: {
        primary: buttonStyle?.backgroundColor || '#2563eb',
        secondary: accentStyle?.backgroundColor || '#64748b',
        accent: accentStyle?.color || '#f59e0b',
        background: bodyStyle.backgroundColor || '#ffffff',
        surface: '#f8fafc',
        text: bodyStyle.color || '#1e293b',
        textMuted: '#64748b',
      },
      fonts: {
        heading: h1Style?.fontFamily?.split(',')[0]?.replace(/['"]/g, '') || 'Inter',
        body: bodyStyle.fontFamily?.split(',')[0]?.replace(/['"]/g, '') || 'Inter',
      },
      borderRadius: buttonStyle?.borderRadius || '8px',
      style: 'modern' as const,
    }
  })
}

/** Extract site-level metadata */
function extractSiteMeta($: cheerio.CheerioAPI, origin: string): SiteMeta {
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')
  const schemaOrg = extractSchemaOrgData($)
  const orgSchema = schemaOrg.find((s: any) => s['@type'] === 'Organization' || s['@type'] === 'LocalBusiness')

  return {
    businessName: orgSchema?.name || ogSiteName || $('title').text().split(/[|–-]/)[0]?.trim() || 'Business',
    tagline: $('meta[name="description"]').attr('content') || '',
    description: orgSchema?.description || $('meta[name="description"]').attr('content') || '',
    logoUrl: orgSchema?.logo?.url || orgSchema?.logo || $('img[class*="logo"], header img').first().attr('src') || undefined,
    contactEmail: orgSchema?.email || extractEmail($),
    contactPhone: orgSchema?.telephone || extractPhone($),
    address: orgSchema?.address?.streetAddress || extractAddress($),
    socialLinks: extractSocialLinks($),
  }
}

/** Extract navigation structure */
function extractNavigation($: cheerio.CheerioAPI, origin: string): NavItem[] {
  const nav = $('nav').first()
  if (!nav.length) return []

  const items: NavItem[] = []
  nav.find('> ul > li, > div > ul > li, > div > a, > a').each((_, el) => {
    const $el = $(el)
    const link = $el.is('a') ? $el : $el.find('> a').first()
    const label = link.text().trim()
    const href = link.attr('href') || '#'

    if (!label || label.length > 50) return

    const children: NavItem[] = []
    $el.find('ul li a').each((_, child) => {
      const $child = $(child)
      children.push({
        label: $child.text().trim(),
        href: resolveHref($child.attr('href') || '#', origin),
      })
    })

    items.push({
      label,
      href: resolveHref(href, origin),
      children: children.length > 0 ? children : undefined,
    })
  })

  return items
}

/** Extract page content into sections */
function extractPageContent($: cheerio.CheerioAPI, url: string, origin: string): PageBlueprint {
  const slug = new URL(url).pathname.replace(/\/$/, '') || '/'
  const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled'
  const pageType = detectPageType($, slug)

  const sections: SectionBlueprint[] = []

  // Hero section (first prominent area)
  const h1 = $('h1').first()
  if (h1.length) {
    const heroParent = h1.closest('section, [class*="hero"], [class*="banner"], header')
    const heroImage = heroParent.find('img').first().attr('src') || $('meta[property="og:image"]').attr('content')
    const heroText = heroParent.find('p').first().text().trim()

    sections.push({
      type: 'hero',
      heading: h1.text().trim(),
      content: heroText || undefined,
      image: heroImage || undefined,
    })
  }

  // Walk through main content sections
  $('main section, [role="main"] section, .section, article section').each((_, el) => {
    const $section = $(el)
    const heading = $section.find('h2, h3').first().text().trim()
    const paragraphs = $section.find('p').map((_, p) => $(p).text().trim()).get().filter(Boolean)
    const images = $section.find('img').map((_, img) => $(img).attr('src')).get().filter(Boolean) as string[]

    // Detect section type by content patterns
    const sectionType = detectSectionType($section, $)

    const section: SectionBlueprint = {
      type: sectionType,
      heading: heading || undefined,
      content: paragraphs.join('\n\n') || undefined,
      image: images[0] || undefined,
    }

    // Extract items for list-like sections
    const items = extractSectionItems($section, $)
    if (items.length > 0) {
      section.items = items
    }

    sections.push(section)
  })

  // If no sections found, extract body content as a single text section
  if (sections.length <= 1) {
    const mainContent = $('main, [role="main"], article, .content').first()
    const textContent = (mainContent.length ? mainContent : $('body'))
      .find('p')
      .map((_, p) => $(p).text().trim())
      .get()
      .filter(Boolean)
      .join('\n\n')

    if (textContent) {
      sections.push({ type: 'text', content: textContent })
    }
  }

  // Extract existing schema
  const schemas: SchemaSpec[] = extractSchemaOrgData($).map((s: any) => ({
    type: s['@type'],
    fields: s,
  }))

  const seo: PageSEO = {
    title: $('title').text().trim() || title,
    description: $('meta[name="description"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || undefined,
    canonical: $('link[rel="canonical"]').attr('href') || undefined,
  }

  return { slug, title, pageType, sections, seo, schema: schemas }
}

/** Detect page type from content signals */
function detectPageType($: cheerio.CheerioAPI, slug: string): PageBlueprint['pageType'] {
  const slugLower = slug.toLowerCase()

  if (slugLower === '/' || slugLower === '/index' || slugLower === '') return 'homepage'
  if (/\/(about|over-ons|qui-sommes)/i.test(slugLower)) return 'about'
  if (/\/(contact|get-in-touch|reach-us)/i.test(slugLower)) return 'contact'
  if (/\/(services?|what-we-do|our-services)/i.test(slugLower)) return 'services'
  if (/\/(products?|shop|store)/i.test(slugLower)) return 'products'
  if (/\/(blog|news|articles?|posts?)/i.test(slugLower)) return 'blog'
  if (/\/(faq|frequently-asked)/i.test(slugLower)) return 'faq'
  if (/\/(gallery|portfolio|work|projects)/i.test(slugLower)) return 'gallery'

  // Check for product indicators
  if ($('[class*="price"], [class*="add-to-cart"], [class*="product"]').length > 2) return 'product-detail'

  return 'generic'
}

/** Detect section type from DOM clues */
function detectSectionType($section: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): SectionBlueprint['type'] {
  const classes = ($section.attr('class') || '').toLowerCase()
  const text = $section.text().toLowerCase()

  if (/testimonial|review|quote/.test(classes)) return 'testimonials'
  if (/faq|accordion|question/.test(classes)) return 'faq'
  if (/pricing|plan/.test(classes)) return 'pricing'
  if (/feature|benefit/.test(classes)) return 'features'
  if (/service/.test(classes)) return 'services'
  if (/team|staff|people/.test(classes)) return 'team'
  if (/gallery|portfolio/.test(classes)) return 'gallery'
  if (/cta|call-to-action/.test(classes)) return 'cta'
  if (/stat|number|counter/.test(classes)) return 'stats'
  if (/contact|form/.test(classes) && $section.find('form').length) return 'contact-form'
  if (/partner|client|logo/.test(classes) && $section.find('img').length > 3) return 'logo-bar'

  // Content heuristic
  if ($section.find('dt, dd, details, summary').length > 2) return 'faq'
  if ($section.find('[class*="card"], [class*="col"]').length > 2) return 'features'

  return 'text'
}

/** Extract list items from a section */
function extractSectionItems($section: cheerio.Cheerio<any>, $: cheerio.CheerioAPI) {
  const items: { title?: string; description?: string; image?: string }[] = []

  $section.find('[class*="card"], [class*="item"], [class*="col"], li').each((_, el) => {
    const $el = $(el)
    const title = $el.find('h3, h4, strong').first().text().trim()
    const description = $el.find('p').first().text().trim()
    const image = $el.find('img').first().attr('src') || undefined

    if (title || description) {
      items.push({ title: title || undefined, description: description || undefined, image })
    }
  })

  return items.slice(0, 20) // cap at 20 items
}

/** Extract image/font assets */
function extractAssets($: cheerio.CheerioAPI, pageUrl: string): AssetRef[] {
  const assets: AssetRef[] = []

  $('img[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) {
      try {
        const resolved = new URL(src, pageUrl).href
        assets.push({ originalUrl: resolved, localPath: '', type: 'image' })
      } catch { /* skip */ }
    }
  })

  return assets
}

/** Extract JSON-LD schema data */
function extractSchemaOrgData($: cheerio.CheerioAPI): any[] {
  const schemas: any[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '')
      if (data['@graph']) {
        schemas.push(...data['@graph'])
      } else if (Array.isArray(data)) {
        schemas.push(...data)
      } else {
        schemas.push(data)
      }
    } catch { /* skip invalid JSON-LD */ }
  })
  return schemas
}

// --- Helper utilities ---

function extractEmail($: cheerio.CheerioAPI): string | undefined {
  const mailto = $('a[href^="mailto:"]').first().attr('href')
  return mailto ? mailto.replace('mailto:', '').split('?')[0] : undefined
}

function extractPhone($: cheerio.CheerioAPI): string | undefined {
  const tel = $('a[href^="tel:"]').first().attr('href')
  return tel ? tel.replace('tel:', '') : undefined
}

function extractAddress($: cheerio.CheerioAPI): string | undefined {
  const addr = $('address').first().text().trim()
  return addr || undefined
}

function extractSocialLinks($: cheerio.CheerioAPI): Record<string, string> {
  const links: Record<string, string> = {}
  const platforms: Record<string, RegExp> = {
    facebook: /facebook\.com/,
    twitter: /twitter\.com|x\.com/,
    linkedin: /linkedin\.com/,
    instagram: /instagram\.com/,
    youtube: /youtube\.com/,
  }

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    for (const [name, pattern] of Object.entries(platforms)) {
      if (pattern.test(href) && !links[name]) {
        links[name] = href
      }
    }
  })

  return links
}

function resolveHref(href: string, origin: string): string {
  try {
    return new URL(href, origin).pathname
  } catch {
    return href
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.origin + u.pathname).replace(/\/$/, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function deduplicateAssets(assets: AssetRef[]): AssetRef[] {
  const seen = new Set<string>()
  return assets.filter((a) => {
    if (seen.has(a.originalUrl)) return false
    seen.add(a.originalUrl)
    return true
  })
}

function buildFallbackMeta(origin: string): SiteMeta {
  return {
    businessName: new URL(origin).hostname.replace('www.', '').split('.')[0] || 'Business',
    description: '',
  }
}

function buildFallbackDesign(): DesignTokens {
  return {
    colors: {
      primary: '#2563eb',
      secondary: '#64748b',
      accent: '#f59e0b',
      background: '#ffffff',
      surface: '#f8fafc',
      text: '#1e293b',
      textMuted: '#64748b',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    borderRadius: '8px',
    style: 'modern',
  }
}
