# CLAUDE.md — AI Site Generator

## What This Project Is

A CLI tool that generates complete, AI-ready static websites using Claude. Three modes:

1. **Rebuild** — Crawl a client's existing site → extract content, design, structure → regenerate as optimized static HTML with perfect AI readiness scores
2. **Clone** — Crawl an inspiration site for layout/design → swap in the client's content → generate a bespoke site with their identity
3. **Generate** — From a text brief + business details → Claude plans the site structure and generates everything from scratch

All modes produce deployable static HTML/CSS with schema.org JSON-LD, proper SEO metadata, and AI-friendly content structure baked in.

## Relationship to AI Readiness Auditor

This is a **separate, standalone project**. It does NOT share code with the auditor (`C:\dev\ai-readiness-auditor`). It can optionally consume the auditor's bridge API (`/api/refactor`) for audit-aware rebuilds, but works independently.

The auditor identifies what's wrong with a site's AI readiness. This tool **fixes it** by generating a new site with everything correct from the start.

## Commands

```bash
npm install                          # Install dependencies
npx playwright install chromium      # Install browser for crawling

# Rebuild an existing site
npx tsx src/cli.ts rebuild --url https://example.com --output ./output/example

# Clone a site's design with different content
npx tsx src/cli.ts clone --inspiration https://nice-site.com --name "My Business" --description "We do X" --output ./output/mybiz

# Generate from scratch
npx tsx src/cli.ts generate --name "My Business" --description "We do X" --brief "A 5-page site for a Cape Town plumber" --industry "plumbing" --output ./output/mybiz
```

## Architecture

### Pipeline
```
Input (URL / brief / content) → Crawler/Planner → Blueprint → Claude Generator → Static Files
```

All three modes converge on the **Blueprint** — a universal intermediate format. The generator doesn't know or care how the blueprint was created.

### Blueprint (Universal Intermediate Format)
`SiteBlueprint` is defined in `src/types/blueprint.ts` and contains:
- `meta` — business identity (name, contact, social, logo, tagline)
- `design` — color palette (7 colors), fonts (heading + body), border radius, style keyword
- `pages[]` — each page with slug, pageType, typed sections, SEO metadata, schema specs
- `navigation` — site nav structure with optional children (dropdowns)
- `assets` — downloaded images/fonts with original URL + local path
- `ecommerce?` — optional cart config (Snipcart/Stripe/Shopify Buy)
- `forms?` — optional form handling (Formspree/Netlify/mailto)

### Key Files
```
src/
├── types/blueprint.ts        # All TypeScript types (SiteBlueprint, PageBlueprint, DesignTokens, etc.)
├── crawler/
│   ├── extract.ts            # Playwright crawler + Cheerio content/design/nav extraction
│   └── download-assets.ts    # Asset downloader (images, fonts → local files)
├── generator/
│   └── generate-site.ts      # Claude API — generates HTML/CSS from blueprint, builds schema
├── modes/
│   ├── rebuild.ts            # Rebuild mode: crawl → extract → download assets → generate
│   ├── clone.ts              # Clone mode: crawl inspiration → merge client content → generate
│   └── generate.ts           # Generate mode: Claude plans structure + design → generate
└── cli.ts                    # Commander CLI entry point (3 subcommands)
```

### Claude API Usage
- **Model**: claude-sonnet-4-20250514 (fast, capable, cost-effective for generation)
- **Calls per site**: 1 (CSS) + N (one per page) + 1-2 (planning + design, in generate mode)
- **Output**: Raw HTML/CSS, stripped of markdown fences
- **Fallbacks**: If Claude's JSON response can't be parsed, deterministic fallback plans are used

### AI Readiness Built In
Generated sites automatically include:
- Exactly 1 H1 per page, proper heading hierarchy (H1 → H2 → H3)
- Schema.org JSON-LD in @graph format (Organization, WebSite, WebPage, BreadcrumbList + page-specific)
- SEO metadata (title 50-70 chars, description 140-170 chars, OG tags, canonical, viewport, charset, lang)
- Semantic HTML5 (`<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`)
- FAQ sections with `<details>`/`<summary>` AND FAQPage schema
- Contact info in both visible HTML and structured data
- Scannable content structure (short paragraphs, lists, clear headings)
- Service/Product schema on relevant page types
- Mobile-responsive CSS with hamburger nav (CSS-only, no JS)
- WCAG AA contrast compliance on generated color palettes

### Crawler Capabilities (`src/crawler/extract.ts`)
- Uses Playwright (headless Chromium) — handles JS-rendered SPAs
- Extracts: design tokens (computed styles), site meta (schema.org + OG + DOM signals), navigation, page sections, assets
- Detects page types from URL patterns and DOM content
- Detects section types from CSS class names and content heuristics
- Extracts existing JSON-LD schema data (including @graph format)
- Discovers internal links for multi-page crawling (configurable max pages)
- Extracts social links, email, phone, address from DOM

### Schema Generation (`generate-site.ts:buildSchemaForPage`)
Deterministic schema generation per page — not LLM-generated:
- Organization (always, from site meta)
- WebSite (always)
- WebPage / AboutPage / ContactPage / FAQPage / CollectionPage / Article (by page type)
- BreadcrumbList (always, from slug)
- FAQPage (if page has FAQ section with items)
- Service (on service pages, from section items)
- Product + Offer (on product pages, from section items)
- Preserves any existing schemas from crawled source (deduped by @type)

## Environment Variables
```
ANTHROPIC_API_KEY=sk-ant-...           # Required — Claude API key
AUDITOR_API_URL=https://...            # Optional — AI Readiness Auditor URL
AUDITOR_API_KEY=...                    # Optional — Auditor project API key
```

## Current State (as of initial scaffold)

### What's Built
- Full type system (Blueprint, all sub-types, CLI input types)
- Playwright crawler with design token extraction
- Asset downloader
- Claude-powered site generator (CSS + per-page HTML)
- All 3 modes (rebuild, clone, generate) with full orchestration
- CLI with Commander (3 subcommands with all options)
- Deterministic schema generation

### What Needs Building (see PROJECT.md for full roadmap)
- Asset URL rewriting (replace original URLs with local paths in generated HTML)
- E-commerce integration (Snipcart product attributes on generated product pages)
- Form handling (Formspree/Netlify Forms injection)
- Preview server (serve generated output locally for review)
- Config file support (JSON/YAML input instead of CLI-only)
- Auditor API integration (fetch audit fixes and bake them into rebuild)
- Image optimization (resize, compress, WebP conversion)
- Sitemap.xml and robots.txt generation
- Post-generation validation (check H1 count, schema validity, meta lengths)
- Output quality scoring (run auditor against generated output)

## Key Conventions

### Code Style
- TypeScript with strict mode
- ES modules (NodeNext resolution, `.js` extensions in imports)
- Async/await throughout, no callbacks
- Console.log for progress output (prefixed with mode name: `[Rebuild]`, `[Clone]`, `[Generate]`)

### Error Handling
- Crawler: try/catch per page, log and continue (don't fail entire crawl for one bad page)
- Asset download: collect errors, report count, continue
- Claude API: try to parse JSON, fall back to deterministic defaults if parsing fails
- Generator: try/catch per page, collect errors, report at end

### Output Structure
Generated sites are written to the specified `--output` directory:
```
output/
├── index.html              # Homepage
├── styles.css              # Global stylesheet
├── about/index.html        # About page
├── services/index.html     # Services page
├── contact/index.html      # Contact page
├── assets/
│   ├── images/             # Downloaded images
│   └── fonts/              # Downloaded fonts
```
