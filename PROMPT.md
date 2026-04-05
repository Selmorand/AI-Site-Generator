# PROMPT.md — AI Site Generator: Complete System Specification

This document is the source of truth for how generated sites must be built. Every HTML page, CSS rule, and schema block produced by this system must conform to these specifications. Claude Code should reference this document when implementing any generation, validation, or quality-checking feature.

---

## 1. The Scoring System We Must Beat

Generated sites are validated against the **AI Readiness Auditor** (`C:\dev\ai-readiness-auditor`). The auditor produces three scores out of 100. Our target is **90+ on all three** for every generated page. Understanding the exact scoring breakdown is critical — every point must be accounted for in generation.

### SCORE 1: AI READINESS (100 points)

#### Structured Data Presence (30 pts) — Deterministic
| Signal | Points | How to earn |
|--------|--------|-------------|
| JSON-LD present on page | 10 | Include `<script type="application/ld+json">` with valid content |
| Schema @type is relevant (not generic) | 10 (relevant) / 5 (generic) | Use Organization, Service, Product, Article, etc. — NOT just WebPage/Thing |
| Schema field completeness | 10 (8+ fields) / 6 (4-7) / 3 (1-3) | Every primary schema must have 8+ fields minimum |

**Generation rule:** Every page MUST have JSON-LD with at least one relevant @type and 8+ fields per primary schema.

#### Service Clarity (25 pts) — LLM-evaluated
| Score Range | Criteria |
|-------------|----------|
| 20-25 | Very clear + specific services, industry terminology used |
| 15-19 | Clear but somewhat generic |
| 10-14 | Vague "solutions" language |
| 5-9 | Very vague |
| 0-4 | Absent |

**Generation rule:** Generated content must use specific service names, industry terminology, and avoid vague words like "solutions", "leverage", "optimize". Name concrete services. Example: "Burst pipe repair" not "plumbing solutions".

#### Machine-Readable Intent (25 pts) — Hybrid
| Signal | Points | How to earn |
|--------|--------|-------------|
| Contact info in structured data | 10 (in schema) / 5 (HTML only) | Include telephone + email in Organization schema AND visible HTML |
| Input/Output clarity (LLM) | 10 | Clearly state what customers provide → what they receive |
| CTA clarity (LLM) | 5 (specific) / 3 (generic) / 1 (vague) | Use "Book a Free 30-Min Consultation" not "Contact Us" |

**Generation rule:** Contact info must appear in BOTH schema and visible HTML. Every service/product page needs an input→output statement. CTAs must be specific and actionable.

#### Content Consistency (20 pts) — LLM-evaluated
| Score Range | Criteria |
|-------------|----------|
| 17-20 | Highly consistent terminology, same business/service names throughout |
| 13-16 | Mostly consistent |
| 9-12 | Some contradictions |
| 5-8 | Significant inconsistencies |

**Generation rule:** Use the exact business name consistently. Don't alternate between abbreviations. Use the same service names in nav, headings, and body text.

### SCORE 2: SEO (100 points)

#### Metadata Quality (30 pts) — Deterministic
| Signal | Points | How to earn |
|--------|--------|-------------|
| Title tag length | 10 (50-70 chars) / 5 (30-90) / 3 (any) | Target exactly 55-65 characters |
| Meta description length | 10 (140-170 chars) / 5 (100-200) / 3 (any) | Target exactly 150-160 characters |
| Open Graph complete | 10 (all 5 tags) / 5 (partial) | Must include og:title, og:description, og:image, og:type, og:url |

**Generation rule:** Every page needs `<title>` (55-65 chars), `<meta name="description">` (150-160 chars), and ALL five OG tags. No exceptions.

#### Page Structure (30 pts) — Deterministic
| Signal | Points | How to earn |
|--------|--------|-------------|
| Exactly 1 H1 tag | 10 (exactly 1) / 5 (multiple) / 0 (none) | ALWAYS exactly one `<h1>` per page |
| Heading hierarchy (H1 + H2s) | 10 (both) / 6 (either alone) | Every page needs H1 + at least 2 H2s |
| Word count | 10 (500+) / 6 (300-499) / 3 (100-299) | Target 500+ words per page minimum |

**Generation rule:** Every page gets exactly 1 H1, 2+ H2s with proper hierarchy (never skip levels), and 500+ words of content.

#### Technical SEO (20 pts) — Deterministic
| Signal | Points | How to earn |
|--------|--------|-------------|
| HTTPS | 10 | N/A for static files (hosting-dependent), but generate canonical URLs with https:// |
| Viewport meta tag | 5 | Always include `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| HTML lang attribute | 5 | Always include `<html lang="en">` (or appropriate language) |

**Generation rule:** Every page must have viewport meta and lang attribute. These are non-negotiable.

#### Content Quality (20 pts) — Deterministic
| Signal | Points | How to earn |
|--------|--------|-------------|
| Image alt text coverage | 10 (80%+) / 6 (50%+) / 3 (any) | Every `<img>` must have a descriptive alt attribute |
| Internal linking | 6 (5+ paragraphs with links) | Include internal links to other pages throughout content |

**Generation rule:** 100% alt text coverage on all images. Cross-link between generated pages in content paragraphs.

### SCORE 3: GEO — Generative Engine Optimization (100 points)

#### Answer-Friendliness (30 pts) — LLM-evaluated
| Score Range | Criteria |
|-------------|----------|
| 25-30 | Page directly answers Who/What/Where/Why/How questions, scannable |
| 20-24 | Good answers, somewhat extractable |
| 15-19 | Partial answers |
| 10-14 | Weak, hard to extract |

**Generation rule:** Structure content to directly answer questions. Use patterns like "We are [business name], a [industry] company in [location]" and "Our [service] helps [customers] by [outcome]".

#### Entity Clarity (30 pts) — Hybrid
| Signal | Points | How to earn |
|--------|--------|-------------|
| Organization schema with name | 6 (deterministic) | Always include Organization with name field |
| H1 contains business name | 6 (deterministic) | Homepage H1 must contain the exact business name |
| Industry in meta description | 6 (deterministic) | Meta description must mention the industry/category |
| Contact info present | 6 (deterministic) | Phone/email visible on page |
| Address/areaServed in schema | 3 (deterministic) | Include in Organization schema |
| LLM entity assessment | 3 (LLM) | Clear business name, industry, location, differentiators |

**Generation rule:** The homepage H1 MUST contain the business name. Every meta description must reference the industry. Organization schema always includes name + address/areaServed.

#### Agent-Friendly Formatting (20 pts) — Hybrid
| Signal | Points | How to earn |
|--------|--------|-------------|
| Scannable structure: H1 + 2+ H2s + 5+ paragraphs | 10 (deterministic) | Standard — already covered by SEO structure rules |
| Key facts prominent (LLM, 2.5 pts each) | 10 | Must include: pricing/rates, location/service area, hours/availability, contact method |

**Generation rule:** Every relevant page must prominently state pricing (or "Contact for quote"), service area, availability, and contact method. Don't bury these — put them in dedicated sections or callout boxes.

#### Ambiguity Reduction (20 pts) — LLM-evaluated
Same as Content Consistency from AI Readiness. Consistent terminology throughout.

---

## 2. Page Type System

The auditor adjusts scoring per page type. Our generator must produce pages that match these expectations exactly.

### Page Type → Scoring Criteria

| Page Type | Excluded Criteria | Boosted Criteria (1.5x) | Critical Schemas |
|-----------|-------------------|------------------------|------------------|
| **Homepage** | (none) | serviceClarity, entityClarity | Organization, WebSite, ContactPoint |
| **Service** | (none) | serviceClarity, inputOutputClarity | Service, Offer, Organization |
| **Product** | (none) | inputOutputClarity, keyFactsProminent | Product, Offer, Organization |
| **Article** | serviceClarity, inputOutputClarity, ctaClarity, keyFactsProminent | contentConsistency, answerFriendliness | Article, Person, Organization |
| **Contact** | serviceClarity, contentConsistency, answerFriendliness, inputOutputClarity, ctaClarity | keyFactsProminent | ContactPage, ContactPoint, Organization |
| **About** | serviceClarity, inputOutputClarity, ctaClarity, keyFactsProminent | entityClarity | AboutPage, Organization |
| **Blog Index** | serviceClarity, answerFriendliness, inputOutputClarity, ctaClarity, keyFactsProminent | entityClarity, contentConsistency | Blog/CollectionPage, Organization |
| **Generic** | (none) | (none — all 1.0x) | WebPage, Organization |

### Content Requirements Per Page Type

**Homepage** must include:
- H1 with business name
- Clear statement of what the business does (first 100 words)
- Service/product overview section
- Social proof (testimonials or stats)
- Specific CTA (not "Contact Us")
- Contact info visible
- Organization + WebSite + BreadcrumbList schema

**Service Page** must include:
- H1 with service name
- What the customer provides (input) → what they receive (output)
- Pricing or pricing guidance ("from R500" or "Contact for quote")
- FAQ section (generates FAQPage schema automatically)
- CTA specific to that service
- Service + Offer schema with provider reference to Organization

**Product Page** must include:
- H1 with product name
- Price, availability, description
- What the buyer gets (clear deliverable)
- Reviews/ratings if available
- Product + Offer schema

**Article/Blog Post** must include:
- H1 with article headline (answers a question or promises value)
- Author name and date
- 500+ words minimum, structured with H2 subheadings
- Scannable: short paragraphs, bullet lists where appropriate
- Article/BlogPosting schema with author (Person) and publisher (Organization)

**Contact Page** must include:
- Phone, email, address — ALL three visible
- Opening hours
- Map reference or directions
- Contact form
- ContactPage + ContactPoint schema

**About Page** must include:
- Business name, founding story or mission
- Team info (names, roles) if provided
- Location, industry
- What differentiates this business
- AboutPage schema

---

## 3. Website Type → Schema Profile

When the user specifies a business/website type, these base schemas are expected site-wide:

| Website Type | Base Schemas |
|-------------|-------------|
| Corporate | Organization, WebSite, AboutPage, ContactPage |
| Local Business | LocalBusiness, Organization, Service, OpeningHoursSpecification |
| E-Commerce | Organization, Product, Offer, AggregateRating, Review, BreadcrumbList |
| Marketplace | Organization, ItemList, Offer, Product, Service |
| SaaS | Organization, SoftwareApplication, WebApplication, Offer, FAQPage |
| Blog | Organization, Blog, BlogPosting, Article, BreadcrumbList |
| Education | EducationalOrganization, Course, Event, FAQPage |
| Professional Service | Organization, Service, FAQPage, Review |

**Additional schemas based on refinement questions:**
- Sells online → add Offer (+ Product for ecommerce/marketplace, + Service for professional/local)
- Has user accounts → add WebApplication (+ SoftwareApplication for SaaS)
- Publishes content → add BlogPosting, Article

---

## 4. Schema.org Generation Standards

### JSON-LD Format
All schema must be output as a single `<script type="application/ld+json">` block in `<head>` using `@graph` array format:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "#organization", ... },
    { "@type": "WebSite", "@id": "#website", ... },
    { "@type": "WebPage", "@id": "#webpage", ... },
    { "@type": "BreadcrumbList", ... },
    ...page-specific schemas
  ]
}
```

### Cross-referencing with @id
- Organization: `"@id": "#organization"`
- WebSite: `"@id": "#website"`, `"publisher": { "@id": "#organization" }`
- WebPage: `"@id": "#webpage"`, `"isPartOf": { "@id": "#website" }`
- Service: `"provider": { "@id": "#organization" }`
- Article: `"publisher": { "@id": "#organization" }`, `"author": { "@type": "Person", "name": "..." }`
- Product: `"brand": { "@id": "#organization" }`

### Field Completeness Targets
Every primary schema must have **8+ fields** to earn full structured data completeness points. Minimum fields:

**Organization** (target 10+ fields):
name, url, description, logo, telephone, email, address (PostalAddress with streetAddress, addressLocality, postalCode, addressCountry), sameAs (array of social URLs), areaServed, contactPoint

**Service** (target 8+ fields):
name, description, provider (@id ref), serviceType, areaServed, offers (Offer with price/priceCurrency/availability), url, category

**Product** (target 8+ fields):
name, description, image, brand (@id ref), offers (Offer), sku, category, url

**Article** (target 8+ fields):
headline, author (Person), datePublished, dateModified, image, publisher (@id ref), description, mainEntityOfPage

**FAQPage** (target: as many Q&A pairs as possible):
mainEntity (array of Question objects, each with name + acceptedAnswer.text)

### Schema Validation Rules
- No duplicate @types in the same @graph
- All @id references must resolve to an entity in the graph
- Price must include priceCurrency
- Dates must be ISO 8601 format
- URLs must be absolute (or relative to site root for generated sites)
- All string values must be properly escaped (no raw HTML in schema text fields)

---

## 5. HTML Generation Standards

### Document Structure
Every generated page must follow this skeleton:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{55-65 characters}</title>
  <meta name="description" content="{150-160 characters}">
  <meta property="og:title" content="{page title}">
  <meta property="og:description" content="{page description}">
  <meta property="og:image" content="{image URL}">
  <meta property="og:type" content="{website|article|...}">
  <meta property="og:url" content="{page URL}">
  <link rel="canonical" href="{page URL}">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">{ "@context": "https://schema.org", "@graph": [...] }</script>
</head>
<body>
  <header>
    <nav aria-label="Main navigation">...</nav>
  </header>
  <main>
    <section><!-- hero/primary content --></section>
    <section><!-- additional sections --></section>
  </main>
  <footer>
    <!-- Business info, contact, social links, copyright -->
  </footer>
</body>
</html>
```

### Heading Rules (Strict)
- Exactly ONE `<h1>` per page — no more, no less
- H1 is always inside `<main>`, never in `<header>` or `<footer>`
- H2s are section headings — every `<section>` should have one
- Never skip heading levels (H1 → H3 without H2 is invalid)
- Homepage H1 MUST contain the business name

### Content Volume Rules
- **Minimum 500 words** per page (homepage can be 600+)
- **Minimum 5 paragraphs** for agent-friendly formatting score
- **Minimum 2 H2** sections per page
- If extracted content from crawler is thin, Claude must **expand** with plausible professional content

### Internal Linking Rules
- Every page must link to at least 2 other generated pages within body content
- Navigation must link to all generated pages
- Footer must include quick links to all main pages
- Use descriptive anchor text (not "click here")

### Image Rules
- Every `<img>` must have a descriptive `alt` attribute (not empty, not filename)
- Use descriptive alt text: "Cape Town plumber repairing a burst pipe" not "img1"
- For decorative images, use `alt=""` with `role="presentation"`

### Accessibility Rules
- `<nav>` must have `aria-label`
- Forms must have `<label>` elements associated with inputs
- Buttons must have accessible text
- Use `<details>`/`<summary>` for FAQ sections (accessible + semantic)
- Sufficient color contrast (WCAG AA — 4.5:1 for normal text, 3:1 for large text)

### Footer Requirements
Every page footer must include:
- Business name
- Phone number (as `<a href="tel:...">`)
- Email (as `<a href="mailto:...">`)
- Address
- Social media links (as icon links with `aria-label`)
- Copyright notice with current year
- Navigation links to all main pages

---

## 6. CSS Generation Standards

### Required Features
- CSS custom properties for all design tokens (colors, fonts, radius)
- Google Fonts `@import` for heading and body fonts
- Mobile-first responsive design
- Breakpoints at 768px (tablet) and 1024px (desktop)
- CSS-only mobile hamburger menu (checkbox hack — no JavaScript)
- Smooth transitions on buttons, links, and interactive elements
- Print stylesheet basics (`@media print`)
- Typography scale with consistent line heights

### Color System
Design tokens must use CSS custom properties:
```css
:root {
  --color-primary: #...;
  --color-secondary: #...;
  --color-accent: #...;
  --color-bg: #...;
  --color-surface: #...;
  --color-text: #...;
  --color-text-muted: #...;
  --font-heading: '...', sans-serif;
  --font-body: '...', sans-serif;
  --radius: 8px;
}
```

### No External Dependencies
- No CSS framework (no Tailwind, Bootstrap, etc.)
- No JavaScript for styling (no CSS-in-JS)
- Pure custom CSS only
- Must work without JavaScript entirely

---

## 7. Mode-Specific Behavior

### Rebuild Mode
1. Crawl the client's existing site (Playwright, max 20 pages)
2. Extract: content, design tokens, navigation, assets, existing schema
3. Download all images/fonts to local output
4. Build Blueprint from extracted data
5. Generate new site that:
   - Keeps ALL original content (don't lose anything the client wrote)
   - Keeps the visual identity (colors, fonts)
   - Fixes structure (proper H1, heading hierarchy, semantic HTML)
   - Adds missing schema (fills gaps, doesn't duplicate existing)
   - Adds missing SEO metadata (title length, description length, OG tags)
   - Adds FAQ sections where appropriate
   - Expands thin content to meet 500-word minimum
   - Makes CTAs specific (replaces "Contact Us" with "Book a Free Consultation")

### Clone Mode
1. Crawl the inspiration site (Playwright, max 15 pages)
2. Extract: structure (page types, section layout), design tokens, navigation structure
3. **DO NOT keep the inspiration site's content** — only structure and design
4. Replace with client's identity (business name, description, contact info)
5. Generate new site that:
   - Mirrors the inspiration site's page structure and section layout
   - Uses the inspiration site's color palette and font choices
   - Contains entirely original content written for the client's business
   - Has correct schema for the client's business (not the inspiration's)
   - Has all AI readiness features baked in

### Generate Mode
1. Claude plans the site structure from the brief (pages, sections, navigation)
2. Claude generates design tokens appropriate to the industry and style preference
3. Generate site from planned blueprint
4. Site should have:
   - 4-8 pages depending on business type
   - Homepage always first, contact page always last
   - Every service page includes FAQ section
   - Homepage: hero → features/services → testimonials → CTA
   - Each page: 3-6 sections
   - Professional content that sounds written by a human, not AI-generated

---

## 8. Content Quality Standards

### Tone & Voice
- Professional but approachable
- Industry-appropriate terminology (legal firms sound different from plumbers)
- Avoid generic AI-sounding phrases: "leverage", "cutting-edge", "synergy", "solutions", "streamline"
- Use concrete specifics: "We repair burst pipes, install geysers, and clear blocked drains" not "We provide comprehensive plumbing solutions"
- Active voice over passive

### FAQ Generation Rules
- 4-6 questions per FAQ section
- Questions must be in natural language (how people actually search)
- Answers must be 2-4 sentences (not one-word, not essays)
- Questions should cover: What/How/Why/How much/Where/When
- Example good question: "How quickly can you respond to a burst pipe emergency?"
- Example bad question: "What are our plumbing services?"

### CTA Specificity Scale
| Bad (1 pt) | OK (3 pts) | Good (5 pts) |
|------------|-----------|--------------|
| Contact Us | Get a Quote | Book Your Free 30-Min Consultation |
| Learn More | Request Info | Download Our 2024 Service Guide |
| Submit | Enquire Now | Get Your Roof Inspection Report — Free |

---

## 9. Post-Generation Validation Checklist

After generating a site, these checks should be run automatically (future feature — build to this spec):

### Per-Page Checks
- [ ] Exactly 1 `<h1>` tag
- [ ] H1 is inside `<main>`
- [ ] At least 2 `<h2>` tags
- [ ] No heading level skips (H1 → H3 without H2)
- [ ] `<title>` length is 50-70 characters
- [ ] `<meta name="description">` length is 140-170 characters
- [ ] All 5 OG tags present (og:title, og:description, og:image, og:type, og:url)
- [ ] `<meta name="viewport">` present
- [ ] `<html lang="...">` present
- [ ] `<meta charset="UTF-8">` present
- [ ] `<link rel="canonical">` present
- [ ] JSON-LD script tag present and contains valid JSON
- [ ] JSON-LD uses @graph format with @context
- [ ] Organization schema has 8+ fields
- [ ] No duplicate @types in @graph
- [ ] Word count ≥ 500
- [ ] Paragraph count ≥ 5
- [ ] All `<img>` tags have non-empty alt attributes
- [ ] At least 2 internal links in body content
- [ ] Footer contains phone, email, address
- [ ] Nav links point to existing generated pages
- [ ] No broken local asset references

### Homepage-Specific Checks
- [ ] H1 contains business name
- [ ] Meta description mentions industry
- [ ] Organization schema includes name, url, description, logo, telephone, email, address, sameAs
- [ ] WebSite schema present

### Site-Wide Checks
- [ ] styles.css exists and is non-empty
- [ ] All pages link to /styles.css
- [ ] Consistent business name across all pages (no variations)
- [ ] Navigation is identical across all pages
- [ ] Every page in navigation has a generated HTML file

---

## 10. Error Recovery

### Claude API Response Parsing
Claude sometimes wraps output in markdown code fences. Always strip:
- `` ```html `` / `` ``` `` from HTML responses
- `` ```css `` / `` ``` `` from CSS responses
- `` ```json `` / `` ``` `` from JSON responses

### JSON Parsing Failures
When Claude returns invalid JSON (for site plans, design tokens):
- Log the raw response for debugging
- Fall back to deterministic defaults
- Never crash — always produce output

### Crawl Failures
- If a page fails to load (timeout, 404, 500), skip it and continue
- If ALL pages fail, abort with a clear error message
- If no `<nav>` found, fall back to link-based navigation discovery
- If design extraction fails, use fallback design tokens

### Content Shortfall
- If extracted content is under 200 words for a page, instruct Claude to expand
- If a page has no sections detected, create a single "text" section from all `<p>` content
- If no H1 found, use `<title>` text as the page title

---

## 11. File Naming & Output Conventions

### Page File Paths
- Homepage: `index.html` (root)
- Other pages: `{slug}/index.html` (directory-based for clean URLs)
- Example: `/about` → `about/index.html`
- Example: `/services/plumbing` → `services/plumbing/index.html`

### Asset Paths
- Images: `assets/images/{sanitized-name}.{ext}`
- Fonts: `assets/fonts/{sanitized-name}.{ext}`
- Sanitize filenames: replace non-alphanumeric with `_`, truncate to 50 chars

### Internal Link Format
- Always use absolute paths from root: `/about`, `/services`, `/contact`
- Never use relative paths (`../about`) — they break depending on directory depth
- CSS reference: `/styles.css` (absolute from root)

---

## 12. Future Integration Points

### Auditor Bridge API
When `--auditor-key` is provided in rebuild mode:
- Call `GET /api/refactor?url={pageUrl}&key={apiKey}` for each crawled page
- Response includes approved fixes with `codeChanges` (type: json-ld, html, dom)
- json-ld fixes → merge into generated schema (add missing, don't duplicate)
- html fixes → merge meta/OG tags (add missing only)
- dom fixes → incorporate into content generation prompt (e.g., "The auditor recommends adding an FAQ section about X")

### Output Scoring
After generation, optionally call `POST /api/analyze` with the generated HTML to get scores:
- Compare against target (90+)
- Report which pages pass/fail and why
- This creates a feedback loop: generate → score → identify gaps → regenerate weak pages

### Dashboard Integration (Future)
The auditor's Pro dashboard could gain a "Generate Site" button that:
1. Takes the project URL and approved fixes
2. Calls this generator via API
3. Returns a downloadable .zip of the generated site
4. Shows before/after score comparison
