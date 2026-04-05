# PROJECT.md — AI Site Generator Roadmap & Status

## Project Vision

Replace the traditional website development workflow (CMS → theme → plugins → content → SEO optimization) with a single AI-powered generation step. Agencies audit a client's site with the AI Readiness Auditor, then generate a replacement site that scores perfectly — or build one from scratch without needing an existing site at all.

### Business Context
- This is an **add-on product** to the AI Readiness Auditor SaaS (`C:\dev\ai-readiness-auditor`)
- Target users: digital agencies managing multiple client websites
- Value prop: "We'll rebuild your site to be AI-ready" is a stronger sell than "Here's a report of what's wrong"
- Revenue model: credit-based (same as auditor) — generating a site costs credits

### Three Generation Modes
1. **Rebuild** — Client has an existing site that scores poorly. Crawl it, extract everything, regenerate it clean.
2. **Clone** — Client likes a competitor's or inspiration site. Clone the layout/design, inject client's content.
3. **Generate** — No existing site needed. Client provides business details + brief, Claude builds everything.

## Current Status: Scaffold Complete

### What Exists (all files written, not yet tested)

| Component | File | Status |
|-----------|------|--------|
| Type system | `src/types/blueprint.ts` | Done — SiteBlueprint, DesignTokens, PageBlueprint, all sub-types |
| Crawler | `src/crawler/extract.ts` | Done — Playwright + Cheerio, design extraction, page/section detection |
| Asset downloader | `src/crawler/download-assets.ts` | Done — Downloads images/fonts to local output dir |
| Site generator | `src/generator/generate-site.ts` | Done — Claude API for CSS + HTML, deterministic schema builder |
| Rebuild mode | `src/modes/rebuild.ts` | Done — Crawl → extract → download → generate |
| Clone mode | `src/modes/clone.ts` | Done — Crawl inspiration → merge client content → generate |
| Generate mode | `src/modes/generate.ts` | Done — Claude plans + designs → generate |
| CLI | `src/cli.ts` | Done — Commander with 3 subcommands |

### What Has NOT Been Done
- `npm install` has not been run
- `npx playwright install chromium` has not been run
- No testing of any mode
- No `.env` file created (only `.env.example`)

## Roadmap

### Phase 1: Get It Running
Priority: Make the existing scaffold functional end-to-end.

- [ ] **Install dependencies** — `npm install` + `npx playwright install chromium`
- [ ] **Create .env** — Add ANTHROPIC_API_KEY
- [ ] **Test generate mode first** — Simplest mode, no crawling needed. Run: `npx tsx src/cli.ts generate --name "Test Business" --description "A test" --brief "Simple 3-page business site" --output ./output/test`
- [ ] **Test rebuild mode** — Pick a simple static site to crawl
- [ ] **Test clone mode** — Crawl one site, swap in different content
- [ ] **Fix issues** — There will be bugs. TypeScript compilation, Playwright quirks, Claude output parsing edge cases.

### Phase 2: Quality & Reliability
Priority: Make the output consistently good.

- [ ] **Post-generation validation** — After generating, check:
  - Exactly 1 H1 per page
  - Valid JSON-LD (parse and validate)
  - Title length 50-70 chars, description 140-170 chars
  - All nav links point to generated pages
  - No broken image references
  - CSS file is valid
- [ ] **Output scoring** — Run the AI Readiness Auditor against generated pages (use the `/api/analyze` endpoint). Target: 90+ on all three scores.
- [ ] **Claude prompt refinement** — Tune the generation prompts based on output quality. The prompts in `generate-site.ts` are the first draft — they will need iteration.
- [ ] **Asset URL rewriting** — After downloading assets, find-and-replace original URLs with local paths in the generated HTML. Currently assets are downloaded but the HTML still references original URLs.
- [ ] **Improve crawler extraction** — The section detection heuristics in `extract.ts` are basic. Test on diverse real sites and refine the CSS class pattern matching and content heuristics.
- [ ] **Handle edge cases** — Sites with no `<nav>`, sites with SPAs that need extra wait time, sites behind auth, sites with lazy-loaded content.

### Phase 3: Features
Priority: Make it production-useful.

- [ ] **Config file input** — Support JSON/YAML config files instead of CLI flags only. For clone/generate modes, the client content is too complex for CLI args alone. Format:
  ```yaml
  mode: generate
  business:
    name: "Cape Plumbing Solutions"
    industry: plumbing
    description: "Licensed plumber in Cape Town"
    phone: "+27 21 555 0123"
    email: info@capeplumbing.co.za
  brief: "Professional plumbing company serving the Cape Town metro area"
  style: modern
  pages:
    - type: services
      title: "Our Plumbing Services"
      content: |
        We offer residential and commercial plumbing...
  ```
- [ ] **Preview server** — Simple Express/http-server to serve the output directory locally. `npx tsx src/cli.ts preview --dir ./output/mybiz`
- [ ] **E-commerce: Snipcart integration** — For product pages, add Snipcart data attributes to buy buttons. Requires Snipcart API key in config. Blueprint already has `EcommerceConfig` type.
- [ ] **Form handling** — Contact forms need a backend. Inject Formspree action URLs or Netlify Forms attributes into generated `<form>` elements. Blueprint already has `FormConfig` type.
- [ ] **Image optimization** — Use sharp to resize, compress, and convert images to WebP after downloading. Serve both WebP and fallback.
- [ ] **Sitemap.xml + robots.txt** — Auto-generate from the list of generated pages.
- [ ] **Favicon generation** — If client provides a logo, generate favicons in multiple sizes.
- [ ] **404 page** — Generate a branded 404 page.

### Phase 4: Auditor Integration
Priority: Connect back to the AI Readiness Auditor.

- [ ] **Fetch audit data during rebuild** — If `--auditor-key` is provided, call `/api/refactor?url=X&key=Y` to get approved fixes and bake them into the rebuild. This means the agency workflow is: audit → approve fixes → rebuild with fixes included.
- [ ] **Score comparison** — After generation, run the auditor on the new output and show before/after scores.
- [ ] **Dashboard integration** — Add a "Generate Site" button in the auditor's Pro dashboard that triggers generation and shows the result.

### Phase 5: Deployment & Packaging
Priority: Make output deployable.

- [ ] **Netlify/Cloudflare Pages deploy** — One-command deploy of generated output. `npx tsx src/cli.ts deploy --dir ./output/mybiz --platform netlify`
- [ ] **ZIP packaging** — Bundle the generated site as a downloadable .zip for clients who deploy manually.
- [ ] **Custom domain support** — Rewrite all URLs (canonical, OG, schema) to use the target domain.
- [ ] **Multi-site batch generation** — Generate sites for multiple clients from a batch config file.

## Technical Decisions

### Why Static HTML (Not Next.js / React / etc.)
- Zero framework overhead — no hydration, no JS runtime, no build step on the client
- Works everywhere — any hosting provider, any CDN, Netlify/Cloudflare Pages/S3/etc.
- Perfect for SEO — bots see complete HTML immediately, no JS execution needed
- AI readiness by default — structured, semantic HTML with schema is trivial in static output
- Agencies can hand off a folder of files — no "you need Node.js installed to run this"

### Why Playwright (Not Just Cheerio/Fetch)
- Many modern sites render content with JavaScript (React, Vue, Angular, Svelte)
- Playwright gets the **rendered DOM** after JS execution — what search engines actually see
- Design token extraction needs `getComputedStyle()` which requires a real browser
- Handles lazy-loaded content, cookie consent overlays, client-side routing

### Why Claude for Generation (Not Templates)
- Templates are rigid — a "plumber template" doesn't work for a "law firm"
- Claude adapts content to the business, industry, and tone
- Can expand thin content with plausible professional copy
- Generates schema.org that's contextually correct, not just boilerplate
- One generator handles all business types and industries

### Why Sonnet (Not Opus)
- Generation is a throughput task — we're generating many pages per site
- Sonnet is significantly faster and cheaper, quality is sufficient for HTML/CSS generation
- Opus reserved for future features where reasoning depth matters (e.g., complex content strategy)

## Known Limitations

- **Not pixel-perfect cloning** — Clone mode extracts design tokens and structure, but the output is "inspired by" not "identical to" the inspiration site. This is by design (avoiding copyright issues) but agencies should know.
- **No JS features** — Generated sites are static HTML/CSS. Interactive features (sliders, animations, dynamic filtering) are not generated. Only exception: CSS-only hamburger menu.
- **Content quality depends on input** — If the client provides a vague 5-word description, Claude can't generate compelling copy. Garbage in, garbage out.
- **No CMS** — Output is flat files. If the client needs to frequently update content, they'll need a CMS (which defeats the purpose of static generation for those pages).
- **Asset licensing** — Downloaded images from crawled sites may be copyrighted. Rebuild mode is fine (client's own assets). Clone mode needs care — inspiration site's images shouldn't be reused.
