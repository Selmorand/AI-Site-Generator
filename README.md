# AI Site Generator

Generate complete, AI-ready static websites using Claude. Rebuild an existing site, clone a design you like, or create from scratch — every output is optimized for AI discoverability, SEO, and Generative Engine Optimization out of the box.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Rebuild    │     │    Clone    │     │   Generate   │
│ Crawl client │     │ Crawl inspo │     │  Text brief  │
│   site       │     │ + client    │     │  + details   │
│              │     │   content   │     │              │
└──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │                    │                    │
       └────────────┬───────┘────────────────────┘
                    ▼
            ┌───────────────┐
            │   Blueprint   │  Universal intermediate format
            │ (structure +  │  (pages, sections, design,
            │  content +    │   nav, meta, schema specs)
            │  design)      │
            └───────┬───────┘
                    ▼
            ┌───────────────┐
            │    Claude     │  Generates HTML + CSS
            │   Generator   │  with AI readiness baked in
            └───────┬───────┘
                    ▼
            ┌───────────────┐
            │  Static Site  │  Deployable HTML/CSS
            │   /output/    │  with schema, SEO, a11y
            └───────────────┘
```

## Quick Start

```bash
# Install
npm install
npx playwright install chromium

# Create .env
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

# Generate a site from scratch
npx tsx src/cli.ts generate \
  --name "Cape Plumbing Solutions" \
  --description "Licensed plumber serving the Cape Town metro area" \
  --brief "Professional plumbing company, 5 pages, residential and commercial services" \
  --industry "plumbing" \
  --phone "+27 21 555 0123" \
  --email "info@capeplumbing.co.za" \
  --address "12 Main Rd, Cape Town, 8001" \
  --style modern \
  --output ./output/cape-plumbing
```

Open `./output/cape-plumbing/index.html` in your browser.

## Three Modes

### Rebuild

Crawl a client's existing website, extract all content, design, and structure, then regenerate it as clean, optimized static HTML.

```bash
npx tsx src/cli.ts rebuild \
  --url https://example.com \
  --output ./output/example-rebuilt
```

**Best for:** Client has a WordPress/Wix/Squarespace site that scores poorly on AI readiness. You want to keep their content but rebuild the structure.

### Clone

Crawl an inspiration site for its layout and design, then swap in the client's own content and identity.

```bash
npx tsx src/cli.ts clone \
  --inspiration https://a-site-i-like.com \
  --name "My Client's Business" \
  --description "What they do" \
  --industry "their industry" \
  --output ./output/my-client
```

**Best for:** Client says "I want a site like [this competitor]" — you take the structure and design, fill it with their brand and content.

### Generate

No existing site needed. Describe the business and what the site should achieve, and Claude plans the structure, picks the design, and generates everything.

```bash
npx tsx src/cli.ts generate \
  --name "My Business" \
  --description "What we do" \
  --brief "A 5-page professional site with services, about, and contact" \
  --industry "consulting" \
  --style minimal \
  --output ./output/my-business
```

**Best for:** New business, or client wants a complete fresh start.

## What You Get

Every generated site includes:

- **Semantic HTML5** — `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`
- **Single H1** per page with proper heading hierarchy
- **Schema.org JSON-LD** in `@graph` format — Organization, WebSite, WebPage, BreadcrumbList, plus page-specific schemas (FAQPage, Service, Product, Article, etc.)
- **SEO metadata** — `<title>` (50-70 chars), meta description (140-170 chars), Open Graph tags, viewport, charset, lang
- **Responsive design** — Mobile-first CSS with breakpoints, CSS-only hamburger menu
- **Accessible** — Proper ARIA labels, semantic elements, `<details>`/`<summary>` for FAQs
- **Fast** — Pure HTML/CSS, no JavaScript framework, no runtime dependencies

## Output Structure

```
output/your-site/
├── index.html                # Homepage
├── styles.css                # Global stylesheet (from design tokens)
├── about/
│   └── index.html            # About page
├── services/
│   └── index.html            # Services page
├── contact/
│   └── index.html            # Contact page
├── assets/
│   ├── images/               # Downloaded images (rebuild/clone modes)
│   └── fonts/                # Downloaded fonts
```

Deploy to any static hosting: Netlify, Cloudflare Pages, Vercel, GitHub Pages, S3, or just upload via FTP.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for site generation |
| `AUDITOR_API_URL` | No | AI Readiness Auditor URL (for audit-aware rebuilds) |
| `AUDITOR_API_KEY` | No | Auditor project API key |

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **AI:** Claude API via `@anthropic-ai/sdk`
- **Crawling:** Playwright (headless Chromium)
- **HTML Parsing:** Cheerio
- **CLI:** Commander
- **Output:** Pure static HTML + CSS (no framework)

## Related Projects

- **AI Readiness Auditor** (`C:\dev\ai-readiness-auditor`) — Audits websites for AI discoverability. This generator is the "fix it" companion to the auditor's "find it" analysis.
