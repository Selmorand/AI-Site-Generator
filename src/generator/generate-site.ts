/**
 * Site Generator — takes a SiteBlueprint and uses OpenAI (gpt-4.1-mini) to generate
 * a complete, deployable static site with AI readiness baked in.
 *
 * CSS is split into two files:
 *  - base.css  — static foundation (copied from src/assets/base.css)
 *  - theme.css — generated :root custom properties for colors/fonts
 */

import OpenAI from 'openai'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { SiteBlueprint, PageBlueprint } from '../types/blueprint.js'
import { tokenTracker } from '../token-tracker.js'

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI()
  return _client
}

/** Path to the static base stylesheet shipped with the tool.
 *  Tries multiple locations to work in both dev (tsx) and production (compiled JS) modes. */
import { accessSync } from 'fs'
import { fileURLToPath } from 'url'

const __esm_filename = fileURLToPath(import.meta.url)
const __esm_dirname = path.dirname(__esm_filename)

function getBaseCssPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'assets', 'base.css'),
    path.resolve(__esm_dirname, '..', 'assets', 'base.css'),
    path.resolve(__esm_dirname, '..', '..', 'src', 'assets', 'base.css'),
  ]
  for (const p of candidates) {
    try { accessSync(p); return p } catch {}
  }
  return candidates[0]
}

export interface GeneratedSite {
  pages: { path: string; html: string }[]
  css: string
  errors: string[]
}

/**
 * Generate the full static site from a blueprint.
 */
export async function generateSite(blueprint: SiteBlueprint, outputDir: string): Promise<GeneratedSite> {
  const errors: string[] = []

  // Step 1: Copy base.css and generate theme.css
  console.log('  Copying base stylesheet...')
  const baseCss = await fs.readFile(getBaseCssPath(), 'utf-8')
  const themeCss = generateThemeCss(blueprint)

  // Step 2: Generate each page
  const pages: { path: string; html: string }[] = []

  for (const page of blueprint.pages) {
    console.log(`  Generating page: ${page.slug}`)
    try {
      const html = await generatePage(blueprint, page)
      const filePath = page.slug === '/' ? 'index.html' : `${page.slug.replace(/^\//, '')}/index.html`
      pages.push({ path: filePath, html })
    } catch (err) {
      errors.push(`Failed to generate ${page.slug}: ${(err as Error).message}`)
    }
  }

  // Step 3: Write files
  await writeSite(outputDir, pages, baseCss, themeCss)

  return { pages, css: themeCss, errors }
}

/**
 * Generate the theme.css content — :root custom properties overriding base.css defaults.
 */
function generateThemeCss(blueprint: SiteBlueprint): string {
  const { design } = blueprint
  const fontImports: string[] = []

  // Google Fonts imports for heading and body fonts
  for (const font of [design.fonts.heading, design.fonts.body]) {
    if (font && font !== 'sans-serif' && font !== 'serif' && font !== 'monospace') {
      const familyParam = font.replace(/\s+/g, '+')
      fontImports.push(`@import url('https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;500;600;700;800&display=swap');`)
    }
  }

  // Derive dark/light variants from the provided colors
  const lines = [
    '/* theme.css — Generated custom properties for this site */',
    '',
    ...fontImports,
    ...(fontImports.length > 0 ? [''] : []),
    ':root {',
    `  /* Colors */`,
    `  --color-primary: ${design.colors.primary};`,
    `  --color-secondary: ${design.colors.secondary};`,
    `  --color-accent: ${design.colors.accent};`,
    `  --color-bg: ${design.colors.background};`,
    `  --color-surface: ${design.colors.surface};`,
    `  --color-text: ${design.colors.text};`,
    `  --color-text-muted: ${design.colors.textMuted};`,
    '',
    `  /* Fonts */`,
    `  --font-heading: '${design.fonts.heading}', sans-serif;`,
    `  --font-body: '${design.fonts.body}', sans-serif;`,
    '',
    `  /* Radius */`,
    `  --radius-md: ${design.borderRadius};`,
    '}',
    '',
  ]

  return lines.join('\n')
}

/**
 * Condensed class reference from base.css, grouped by component.
 * Included in every page-generation prompt so the LLM uses known classes.
 */
const CSS_CLASS_REFERENCE = `
AVAILABLE CSS CLASSES (from base.css — use ONLY these, do NOT invent new class names):

LAYOUT:
  .container — centered max-width wrapper with responsive padding

GRID:
  .grid — base grid with gap
  .grid--2 — 2-column responsive grid
  .grid--3 — 3-column responsive grid (collapses to 2 then 1)
  .grid--4 — 4-column responsive grid (collapses to 2 then 1)

SECTIONS:
  .section — padded section (white bg)
  .section.section--surface — padded section (surface/light gray bg)
  .section.section--dark — padded section (dark bg, light text, white headings)

NAVIGATION (use <nav> element, sticky top):
  .nav-container — flex container inside <nav> (brand left, links right)
  .nav-brand — logo/business name link
  input.nav-toggle (type="checkbox", id="nav-toggle") — hidden checkbox for mobile menu
  label.nav-toggle-label (for="nav-toggle") — hamburger button with 3 <span> bars
  .nav-links — <ul> of nav links; use input.nav-toggle:checked ~ .nav-links to show on mobile
  .nav-links a.active — highlighted current page link

HERO:
  .hero — full-width gradient hero section (primary→secondary, centered white text)
  .hero-cta — flex row of CTA buttons inside hero

BUTTONS:
  .btn — base button styles
  .btn.btn--primary — primary color button
  .btn.btn--secondary — secondary color button
  .btn.btn--accent — accent color button
  .btn.btn--outline — outline/ghost button (auto-inverts on dark bg)
  .btn.btn--lg — larger button size

CARDS:
  .card — white card with border, shadow, hover lift
  .card-grid — responsive auto-fit grid for cards

SERVICES / FEATURES:
  .service-item — centered service card with border, hover lift
  .feature-item — centered feature block (for icon + heading + text)
  .features-grid — responsive 2→3 column grid for features

TESTIMONIALS:
  .testimonial — quote card with accent left border and opening-quote decoration
  .testimonial p — italic quote text
  .testimonial cite — author attribution
  .testimonials-grid — responsive 2→3 column grid

FAQ:
  .faq-list — wrapper (max-width 800px centered)
  Inside .faq-list use <details> + <summary> for each Q&A
  Answer content in <details> > <div> or <details> > <p>

FORMS:
  .form-group — form field wrapper with bottom margin
  .form-label — styled label
  .form-input — text/email/tel input
  .form-textarea — textarea
  .form-select — styled select dropdown

FOOTER (use <footer> element, dark bg):
  .footer-content — responsive grid (2fr 1fr 1fr 1fr on desktop)
  .footer-section — column in footer (use h3/h4 for heading, ul for links, p for text)
  .social-links — flex row of circular social link icons
  .footer-bottom — copyright bar with top border

STATS:
  .stats-grid — 2→4 column centered grid
  .stat-number — large primary-colored number
  .stat-label — small muted label below number

CTA:
  .cta — gradient call-to-action section (same style as hero, centered white text)

CONTACT:
  .contact-grid — 2-column grid (info + form)
  .contact-info — info column (h3, p elements with flex gap for icon+text)

PRICING:
  .pricing-grid — responsive 2→3 column grid
  .pricing-card — centered card with border
  .pricing-card.pricing-card--featured — highlighted tier (scaled, primary border)
  .pricing-price — large primary number; use <span> for "/month" suffix
  .pricing-card ul — feature checklist (auto checkmarks via ::before)

TEAM:
  .team-grid — responsive 2→3 column grid
  .team-member — centered block with circular img, h3, p

GALLERY:
  .gallery-grid — responsive 2→3→4 column grid with hover zoom

TYPOGRAPHY:
  .text-muted — muted text color
  .text-center — centered text

UTILITIES:
  .sr-only — screen-reader only
  .mb-sm, .mb-md, .mb-lg, .mb-xl — bottom margin
  .mt-sm, .mt-md, .mt-lg, .mt-xl — top margin
`.trim()

/** Generate a single page's HTML */
async function generatePage(blueprint: SiteBlueprint, page: PageBlueprint): Promise<string> {
  const { meta, navigation } = blueprint

  // Calculate relative path to root for CSS/asset linking
  const depth = page.slug === '/' ? 0 : page.slug.replace(/^\//, '').split('/').length
  const baseCssPath = depth === 0 ? './base.css' : '../'.repeat(depth) + 'base.css'
  const themeCssPath = depth === 0 ? './theme.css' : '../'.repeat(depth) + 'theme.css'

  const sectionsDesc = (page.sections ?? [])
    .map((s, i) => {
      let desc = `Section ${i + 1}: type="${s.type}"`
      if (s.heading) desc += `, heading="${s.heading}"`
      if (s.content) desc += `, content="${s.content.slice(0, 200)}..."`
      if (s.items?.length) desc += `, ${s.items.length} items: ${JSON.stringify(s.items.slice(0, 3))}`
      if (s.image) desc += `, image="${s.image}"`
      return desc
    })
    .join('\n')

  // Build relative navigation links for this page's depth
  const rootPrefix = depth === 0 ? './' : '../'.repeat(depth)
  const navDesc = navigation.map((n) => {
    const href = n.href === '/'
      ? rootPrefix
      : rootPrefix + n.href.replace(/^\//, '') + '/'
    return `${n.label} → ${href}`
  }).join(', ')

  const schemaSpecs = buildSchemaForPage(blueprint, page)

  const response = await getClient().chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Generate a complete HTML page for a static website.

${CSS_CLASS_REFERENCE}

BUSINESS: ${meta.businessName}
${meta.tagline ? `TAGLINE: ${meta.tagline}` : ''}
${meta.description ? `DESCRIPTION: ${meta.description}` : ''}
${meta.contactPhone ? `PHONE: ${meta.contactPhone}` : ''}
${meta.contactEmail ? `EMAIL: ${meta.contactEmail}` : ''}
${meta.address ? `ADDRESS: ${meta.address}` : ''}

PAGE: ${page.title} (${page.pageType})
SLUG: ${page.slug}

NAVIGATION: ${navDesc}

SECTIONS:
${sectionsDesc}

SEO:
- Title: ${page.seo?.title || page.title}
- Description: ${page.seo?.description || ''}
${page.seo?.ogImage ? `- OG Image: ${page.seo.ogImage}` : ''}

SCHEMA JSON-LD TO INCLUDE:
${JSON.stringify(schemaSpecs, null, 2)}

Requirements:
- Complete HTML5 document with <!DOCTYPE html>
- Link to BOTH "${baseCssPath}" AND "${themeCssPath}" (external stylesheets — use these EXACT paths). Put theme.css AFTER base.css so it overrides custom properties.
- Use ONLY the CSS classes listed above. Do NOT invent new class names or write inline styles or <style> blocks.
- Semantic HTML: <header> is NOT used — the nav is a top-level <nav> element. Use <main>, <section>, <footer>.
- Exactly ONE <h1> tag per page
- Proper heading hierarchy (H1 → H2 → H3, no skipping)
- All schema JSON-LD in a single <script type="application/ld+json"> with @graph array in <head>
- Proper <title>, meta description, viewport, lang="en", charset, OG tags
- Navigation structure: <nav> > .nav-container > [ .nav-brand (a), input.nav-toggle#nav-toggle, label.nav-toggle-label[for="nav-toggle"] with 3 <span>, ul.nav-links > li > a ]
- The hamburger label must contain exactly 3 <span> elements (the CSS animates them into an X)
- Navigation links MUST use the EXACT href values from the NAVIGATION list above. Do NOT change them to absolute paths.
- Current page nav link gets class="active"
- Footer structure: <footer> > .container > .footer-content (grid) > .footer-section columns; then .footer-bottom for copyright
- Content must be scannable: short paragraphs, bullet points where appropriate
- FAQ sections: wrap in .faq-list, use <details> + <summary> for each Q&A, answer in <div>; ALSO include FAQPage schema
- Contact info visible in HTML AND in schema
- Images use descriptive alt text
- Add appropriate aria-labels for accessibility
- If content sections seem thin, expand them with plausible professional content that fits the business

Return ONLY the HTML code, no explanation.`,
      },
    ],
  })

  const text = response.choices[0]?.message?.content || ''

  tokenTracker.track(`Page: ${page.slug}`, {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })

  return text.replace(/^```html\n?/m, '').replace(/\n?```$/m, '')
}

/** Build schema.org JSON-LD specs for a page */
function buildSchemaForPage(blueprint: SiteBlueprint, page: PageBlueprint): object[] {
  const { meta } = blueprint
  const schemas: object[] = []

  // Organization — always present
  schemas.push({
    '@type': 'Organization',
    name: meta.businessName,
    description: meta.description,
    url: meta.logoUrl ? undefined : '#',
    logo: meta.logoUrl,
    telephone: meta.contactPhone,
    email: meta.contactEmail,
    address: meta.address
      ? { '@type': 'PostalAddress', streetAddress: meta.address }
      : undefined,
    sameAs: meta.socialLinks ? Object.values(meta.socialLinks) : undefined,
  })

  // WebSite — always present
  schemas.push({
    '@type': 'WebSite',
    name: meta.businessName,
    url: '#',
  })

  // WebPage — always present
  const seo = page.seo ?? { title: page.title, description: '' }
  schemas.push({
    '@type': pageTypeToSchemaType(page.pageType),
    name: seo.title,
    description: seo.description,
  })

  // BreadcrumbList
  schemas.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: '/' },
      ...(page.slug !== '/'
        ? [{ '@type': 'ListItem', position: 2, name: page.title, item: page.slug }]
        : []),
    ],
  })

  // FAQ if page has FAQ sections
  const sections = page.sections ?? []
  const faqSection = sections.find((s) => s.type === 'faq')
  if (faqSection?.items?.length) {
    schemas.push({
      '@type': 'FAQPage',
      mainEntity: faqSection.items.map((item) => ({
        '@type': 'Question',
        name: item.title,
        acceptedAnswer: { '@type': 'Answer', text: item.description },
      })),
    })
  }

  // Service schema for service pages
  if (page.pageType === 'services' || page.pageType === 'service-detail') {
    const serviceSection = sections.find((s) => s.type === 'services')
    if (serviceSection?.items?.length) {
      for (const item of serviceSection.items.slice(0, 5)) {
        schemas.push({
          '@type': 'Service',
          name: item.title,
          description: item.description,
          provider: { '@type': 'Organization', name: meta.businessName },
        })
      }
    }
  }

  // Product schema for product pages
  if (page.pageType === 'products' || page.pageType === 'product-detail') {
    const productSection = sections.find((s) => s.type === 'products')
    if (productSection?.items?.length) {
      for (const item of productSection.items.slice(0, 5)) {
        schemas.push({
          '@type': 'Product',
          name: item.title,
          description: item.description,
          image: item.image,
          offers: item.price
            ? { '@type': 'Offer', price: item.price, priceCurrency: 'USD' }
            : undefined,
        })
      }
    }
  }

  // Preserve any existing schemas from the crawl
  for (const existing of page.schema ?? []) {
    if (!existing?.type || !existing?.fields) continue
    const alreadyHasType = schemas.some(
      (s: any) => s?.['@type'] === existing.type
    )
    if (!alreadyHasType) {
      schemas.push(existing.fields)
    }
  }

  return schemas
}

function pageTypeToSchemaType(pageType: string): string {
  const map: Record<string, string> = {
    homepage: 'WebPage',
    about: 'AboutPage',
    contact: 'ContactPage',
    faq: 'FAQPage',
    blog: 'CollectionPage',
    'blog-post': 'Article',
  }
  return map[pageType] || 'WebPage'
}

/** Write generated files to disk */
async function writeSite(
  outputDir: string,
  pages: { path: string; html: string }[],
  baseCss: string,
  themeCss: string
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Write base.css (copied from src/assets/)
  await fs.writeFile(path.join(outputDir, 'base.css'), baseCss, 'utf-8')

  // Write theme.css (generated from blueprint design tokens)
  await fs.writeFile(path.join(outputDir, 'theme.css'), themeCss, 'utf-8')

  // Write each page
  for (const page of pages) {
    const fullPath = path.join(outputDir, page.path)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, page.html, 'utf-8')
  }

  console.log(`  Wrote ${pages.length} pages + base.css + theme.css`)
}
