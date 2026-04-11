/**
 * Site Generator — takes a SiteBlueprint and uses OpenAI (gpt-4.1-mini) to generate
 * a complete, deployable static site with AI readiness baked in.
 *
 * CSS is split into three files:
 *  - base.css     — static foundation (copied from src/assets/base.css)
 *  - theme.css    — generated :root custom properties for colors/fonts
 *  - template.css — template-specific overrides (copied from src/assets/templates/{template}.css)
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

function getTemplateCssPath(template: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'assets', 'templates', `${template}.css`),
    path.resolve(__esm_dirname, '..', 'assets', 'templates', `${template}.css`),
    path.resolve(__esm_dirname, '..', '..', 'src', 'assets', 'templates', `${template}.css`),
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
export async function generateSite(blueprint: SiteBlueprint, outputDir: string, template: string = 'modern'): Promise<GeneratedSite> {
  const errors: string[] = []

  // Step 1: Copy base.css, generate theme.css, and copy template.css
  console.log('  Copying stylesheets...')
  const baseCss = await fs.readFile(getBaseCssPath(), 'utf-8')
  const themeCss = generateThemeCss(blueprint)
  const templateCss = await fs.readFile(getTemplateCssPath(template), 'utf-8')

  // Step 2: Generate shared nav + footer (one LLM call)
  console.log('  Generating shared nav & footer...')
  const shell = await generateShell(blueprint, template)

  // Step 3: Generate main content for each page
  const pages: { path: string; html: string }[] = []

  for (const page of blueprint.pages) {
    console.log(`  Generating page: ${page.slug}`)
    try {
      const mainContent = await generatePageContent(blueprint, page, template)
      const html = assembleFullPage(blueprint, page, shell, mainContent, template)
      const filePath = page.slug === '/' ? 'index.html' : `${page.slug.replace(/^\//, '')}/index.html`
      pages.push({ path: filePath, html })
    } catch (err) {
      errors.push(`Failed to generate ${page.slug}: ${(err as Error).message}`)
    }
  }

  // Step 4: Write files
  await writeSite(outputDir, pages, baseCss, themeCss, templateCss)

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

HERO (choose ONE style per page):
  Style A — Background image hero (full-width, centered text):
    .hero — with inline background-image style + .hero-overlay div + .container
  Style B — Split hero (text left, image right):
    .hero-split > .hero-split-content (text side) + .hero-split-image (with background-image)
    .hero-split--reverse — image left, text right
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

SERVICES / FEATURES (choose a layout pattern):
  Pattern A — Icon grid:
    .features-grid > .icon-box (centered icon + heading + text)
    .icon-box-icon — circular primary-bg icon wrapper (use FA icon inside)
    .icon-box-icon--outline — outline variant
    .icon-box-icon--square — square rounded variant
  Pattern B — Icon rows (left-aligned):
    .icon-box.icon-box--left — icon left, text right, horizontal layout
  Pattern C — Image cards:
    .card-grid > .image-card > img + .image-card-body (h3 + p)
  Pattern D — Simple cards:
    .card-grid > .card (heading + text, no image)
  Legacy (still available):
    .service-item — centered service card with border
    .feature-item — centered feature block
    .features-grid — responsive grid

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

SPLIT CONTENT (alternating image + text blocks):
  .split — flex row (stacks on mobile): .split-content + .split-image > img
  .split--reverse — image left, text right

SECTION HEADERS (intro above grid/content):
  .section-header — centered h2 + subtitle p (max-width 700px)
  .section-header--left — left-aligned variant

STEPS / PROCESS:
  .steps-list > .step-item — auto-numbered steps (circle number + h3 + p)

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

/** Shared shell — nav + footer HTML generated once and reused on all pages */
interface SiteShell {
  navHtml: string
  footerHtml: string
}

async function generateShell(blueprint: SiteBlueprint, template: string): Promise<SiteShell> {
  const { meta, navigation } = blueprint
  const navLinks = navigation.map((n) => `${n.label} → ${n.href}`).join(', ')

  // Determine if nav/footer have dark backgrounds (for reverse logo)
  const isDarkNav = template === 'bold'
  const logoForNav = (isDarkNav && meta.logoReverseUrl) ? meta.logoReverseUrl : (meta.logoUrl || '')
  const logoForFooter = meta.logoReverseUrl || meta.logoUrl || ''

  const response = await getClient().chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Generate ONLY the <nav> and <footer> HTML for a static website. These will be reused on every page.

BUSINESS: ${meta.businessName}
${meta.tagline ? `TAGLINE: ${meta.tagline}` : ''}
${meta.contactPhone ? `PHONE: ${meta.contactPhone}` : ''}
${meta.contactEmail ? `EMAIL: ${meta.contactEmail}` : ''}
${meta.address ? `ADDRESS: ${meta.address}` : ''}
NAVIGATION LINKS: ${navLinks}
${logoForNav ? `NAV LOGO: <img src="${logoForNav}" alt="${meta.businessName}" style="height:2.2rem;">` : `NAV BRAND TEXT: ${meta.businessName}`}
${logoForFooter ? `FOOTER LOGO: <img src="${logoForFooter}" alt="${meta.businessName}" style="height:2rem;">` : ''}

Return a JSON object with two keys (no markdown fences):
{
  "nav": "<nav>...complete nav HTML...</nav>",
  "footer": "<footer>...complete footer HTML...</footer>"
}

Nav structure: <nav> > .nav-container > [ .nav-brand (a, with logo img or text), input.nav-toggle#nav-toggle(type=checkbox), label.nav-toggle-label[for="nav-toggle"] with 3 <span>, ul.nav-links > li > a ]
- Navigation hrefs: use EXACTLY as given above. Do NOT modify them.
- The hamburger label must have exactly 3 <span> elements.
- Include Font Awesome icons in nav if appropriate.

Footer structure: <footer> > .container > .footer-content (grid) > .footer-section columns with: about/description, quick links, contact info (with FA icons), social links. Then .footer-bottom for copyright.
- Use Font Awesome icons for contact (fa-phone, fa-envelope, fa-map-marker-alt) and social (fa-facebook, fa-twitter, fa-instagram, fa-linkedin).
- Footer logo in the first footer-section if FOOTER LOGO is provided.
- Copyright: © ${new Date().getFullYear()} ${meta.businessName}. All rights reserved.

Return ONLY the JSON, no explanation.`,
      },
    ],
  })

  tokenTracker.track('Nav & Footer', {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })

  const raw = response.choices[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '')
    const parsed = JSON.parse(cleaned)
    return { navHtml: parsed.nav || '', footerHtml: parsed.footer || '' }
  } catch {
    // Fallback shell
    return {
      navHtml: `<nav><div class="nav-container"><a class="nav-brand" href="/">${meta.businessName}</a></div></nav>`,
      footerHtml: `<footer><div class="container"><div class="footer-bottom"><p>© ${new Date().getFullYear()} ${meta.businessName}</p></div></div></footer>`,
    }
  }
}

/** Generate only the <main> content for a page (no nav/footer) */
async function generatePageContent(blueprint: SiteBlueprint, page: PageBlueprint, template: string = 'modern'): Promise<string> {
  const { meta } = blueprint
  const industrySeed = (meta.industry || 'business').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase()
  const pageSeed = page.slug.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase() || 'home'

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

  const response = await getClient().chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 12000,
    messages: [
      {
        role: 'user',
        content: `Generate ONLY the <main> content (no <html>, <head>, <nav>, or <footer>) for a page on a static website.

${CSS_CLASS_REFERENCE}

BUSINESS: ${meta.businessName}
${meta.description ? `DESCRIPTION: ${meta.description}` : ''}
INDUSTRY: ${meta.industry || 'general'}

PAGE: ${page.title} (${page.pageType})
SLUG: ${page.slug}

SECTIONS:
${sectionsDesc}

Requirements:
- Return ONLY the content inside <main>. No <!DOCTYPE>, <html>, <head>, <nav>, or <footer>.
- Use ONLY CSS classes from the reference above. Do NOT invent class names or use inline styles (except background-image on hero).
- EVERY <section> MUST contain a <div class="container"> as its first child.
- Exactly ONE <h1> tag. Proper heading hierarchy (H1 → H2 → H3).
- Use Font Awesome 6 icons throughout: <i class="fas fa-..."></i>

LAYOUT RULES — create visual variety by mixing these patterns:

HERO (first section):
  For homepages, use the split hero:
    <section class="hero-split">
      <div class="hero-split-content">
        <h1>...</h1><p>...</p>
        <div class="hero-cta"><a class="btn btn--primary btn--lg">...</a><a class="btn btn--outline btn--lg">...</a></div>
      </div>
      <div class="hero-split-image" style="background-image: url('https://picsum.photos/seed/${industrySeed}-hero/1600/800');"></div>
    </section>
  For subpages, use the background image hero:
    <section class="hero" style="background-image: url('https://picsum.photos/seed/${industrySeed}-${pageSeed}/1600/800'); background-size: cover; background-position: center;">
      <div class="hero-overlay"></div>
      <div class="container"><h1>...</h1><p>...</p></div>
    </section>

FEATURE/SERVICE SECTIONS — alternate between these patterns (don't use the same one twice in a row):
  Pattern 1 — Icon boxes (centered grid):
    <div class="section-header"><h2>...</h2><p>...</p></div>
    <div class="features-grid">
      <div class="icon-box">
        <div class="icon-box-icon"><i class="fas fa-..."></i></div>
        <h3>...</h3><p>...</p>
      </div>
      ...repeat...
    </div>
  Pattern 2 — Image cards:
    <div class="section-header"><h2>...</h2><p>...</p></div>
    <div class="card-grid">
      <div class="image-card">
        <img src="https://picsum.photos/seed/{keyword}/600/400" alt="...">
        <div class="image-card-body"><h3>...</h3><p>...</p></div>
      </div>
      ...repeat...
    </div>
  Pattern 3 — Split content (alternating image + text):
    <div class="split">
      <div class="split-content"><h2>...</h2><p>...</p></div>
      <div class="split-image"><img src="https://picsum.photos/seed/{keyword}/800/600" alt="..."></div>
    </div>
    Then use .split.split--reverse for the next one to alternate sides.

ABOUT / TEXT SECTIONS:
  Use .split for image + text side by side, NOT just paragraphs stacked.

PROCESS / HOW IT WORKS:
  <div class="steps-list">
    <div class="step-item"><div><h3>...</h3><p>...</p></div></div>
    ...repeat (auto-numbered via CSS)...
  </div>

STATS:
  <div class="stats-grid">
    <div><div class="stat-number">500+</div><div class="stat-label">Projects</div></div>
    ...repeat...
  </div>

TESTIMONIALS:
  <div class="section-header"><h2>...</h2></div>
  <div class="testimonials-grid">
    <div class="testimonial"><p>"Quote..."</p><cite>Name, Title</cite></div>
    ...repeat...
  </div>

CTA SECTION:
  <section class="cta"><div class="container">
    <h2>...</h2><p>...</p>
    <div class="hero-cta"><a class="btn btn--accent btn--lg">...</a></div>
  </div></section>

IMAGE RULES:
- Use Picsum for ALL images: https://picsum.photos/seed/{keyword}/{width}/{height}
- Keywords: single lowercase words, hyphenated, NO spaces. Use unique keywords per image.
- Hero: 1600/800, Cards: 600/400, Split: 800/600, Team: 400/400, Gallery: 600/600

SECTION ORDER — create a natural flow, typically:
  Homepage: hero → features/services → split about → stats → testimonials → CTA
  Service page: hero → service detail (split) → process steps → pricing → FAQ → CTA
  About page: hero → split story → team → stats → testimonials
  Contact page: hero → contact-grid (info + form)

Return ONLY the HTML, no explanation.`,
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

/** Assemble a full HTML page from shared shell + page content */
function assembleFullPage(
  blueprint: SiteBlueprint,
  page: PageBlueprint,
  shell: SiteShell,
  mainContent: string,
  template: string
): string {
  const { meta, navigation } = blueprint
  const depth = page.slug === '/' ? 0 : page.slug.replace(/^\//, '').split('/').length
  const rootPrefix = depth === 0 ? './' : '../'.repeat(depth)
  const baseCssPath = rootPrefix + 'base.css'
  const themeCssPath = rootPrefix + 'theme.css'
  const templateCssPath = rootPrefix + 'template.css'

  const seo = page.seo ?? { title: page.title, description: '' }
  const schemaSpecs = buildSchemaForPage(blueprint, page)

  // Build nav with active link for this page
  let navHtml = shell.navHtml
  // Set active class on current page's nav link
  for (const navItem of navigation) {
    const href = navItem.href === '/'
      ? rootPrefix
      : rootPrefix + navItem.href.replace(/^\//, '') + '/'
    // Replace href values with relative versions
    if (navItem.href === page.slug) {
      navHtml = navHtml.replace(
        new RegExp(`href="${navItem.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
        `href="${href}" class="active" aria-current="page"`
      )
    } else {
      navHtml = navHtml.replace(
        new RegExp(`href="${navItem.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
        `href="${href}"`
      )
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${seo.title}</title>
  <meta name="description" content="${seo.description}">
  <meta property="og:title" content="${seo.title}">
  <meta property="og:description" content="${seo.description}">
  <meta property="og:type" content="website">
  ${meta.faviconUrl ? `<link rel="icon" href="${meta.faviconUrl}">` : ''}
  <link rel="stylesheet" href="${baseCssPath}">
  <link rel="stylesheet" href="${themeCssPath}">
  <link rel="stylesheet" href="${templateCssPath}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@graph': schemaSpecs }, null, 2)}
  </script>
</head>
<body>
${navHtml}
<main>
${mainContent}
</main>
${shell.footerHtml}
</body>
</html>`
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
  themeCss: string,
  templateCss: string
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Write base.css (copied from src/assets/)
  await fs.writeFile(path.join(outputDir, 'base.css'), baseCss, 'utf-8')

  // Write theme.css (generated from blueprint design tokens)
  await fs.writeFile(path.join(outputDir, 'theme.css'), themeCss, 'utf-8')

  // Write template.css (copied from src/assets/templates/)
  await fs.writeFile(path.join(outputDir, 'template.css'), templateCss, 'utf-8')

  // Write each page
  for (const page of pages) {
    const fullPath = path.join(outputDir, page.path)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, page.html, 'utf-8')
  }

  console.log(`  Wrote ${pages.length} pages + base.css + theme.css + template.css`)
}
