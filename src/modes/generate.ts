/**
 * Generate Mode — create a site from scratch based on a text brief
 * and client content. No existing site needed.
 */

import OpenAI from 'openai'
import { generateSite } from '../generator/generate-site.js'
import type {
  SiteBlueprint,
  GenerateInput,
  PageBlueprint,
  DesignTokens,
  NavItem,
} from '../types/blueprint.js'
import { tokenTracker } from '../token-tracker.js'

const client = new OpenAI()

export async function generate(input: GenerateInput, outputDir: string) {
  console.log(`\n[Generate] Creating site from scratch for: ${input.clientContent.businessName}`)

  // Step 1: Use Claude to plan the site structure from the brief
  console.log(`[Generate] Planning site structure...`)
  const sitePlan = await planSiteStructure(input)

  // Step 2: Generate design tokens
  console.log(`[Generate] Generating design...`)
  const design = await generateDesignTokens(input)

  // Step 3: Build blueprint
  const blueprint: SiteBlueprint = {
    mode: 'generate',
    meta: {
      businessName: input.clientContent.businessName,
      tagline: input.clientContent.tagline,
      industry: input.clientContent.industry,
      description: input.clientContent.description,
      logoUrl: input.clientContent.logoUrl,
      contactEmail: input.clientContent.contactEmail,
      contactPhone: input.clientContent.contactPhone,
      address: input.clientContent.address,
      socialLinks: input.clientContent.socialLinks,
    },
    design,
    pages: sitePlan.pages,
    navigation: sitePlan.navigation,
    assets: [],
  }

  // Step 4: Generate
  console.log(`[Generate] Generating ${blueprint.pages.length} pages with GPT-4.1-mini...`)
  const result = await generateSite(blueprint, outputDir)

  console.log(`[Generate] Done! Generated ${result.pages.length} pages`)
  if (result.errors.length > 0) {
    console.log(`[Generate] Errors: ${result.errors.join(', ')}`)
  }

  tokenTracker.printSummary()

  return result
}

/** Ask Claude to plan what pages and sections the site should have */
async function planSiteStructure(
  input: GenerateInput
): Promise<{ pages: PageBlueprint[]; navigation: NavItem[] }> {
  const { clientContent, brief } = input

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: `You are a web architect. Plan a static website structure for this business.

BUSINESS: ${clientContent.businessName}
INDUSTRY: ${clientContent.industry || 'not specified'}
DESCRIPTION: ${clientContent.description}
BRIEF: ${brief}

Return a JSON object (no markdown, no explanation) with this exact structure:
{
  "pages": [
    {
      "slug": "/",
      "title": "Page Title",
      "pageType": "homepage|about|services|service-detail|products|product-detail|contact|blog|faq|gallery|generic",
      "sections": [
        {
          "type": "hero|text|features|services|products|testimonials|faq|cta|gallery|team|pricing|contact-form|stats|logo-bar",
          "heading": "Section Heading",
          "content": "Brief description of what content should go here",
          "items": [
            { "title": "Item title", "description": "Item description" }
          ]
        }
      ],
      "seo": {
        "title": "SEO Title (50-70 chars)",
        "description": "Meta description (140-170 chars)"
      },
      "schema": []
    }
  ],
  "navigation": [
    { "label": "Home", "href": "/" },
    { "label": "About", "href": "/about" }
  ]
}

Rules:
- Homepage is always first, contact page always last
- 4-8 pages total depending on the business type
- Every service page should have an FAQ section
- Homepage needs: hero, features/services overview, testimonials, CTA
- Each page needs 3-6 sections
- SEO titles must be 50-70 characters, descriptions 140-170 characters
- Include the business name in the homepage H1/hero
- Think about what pages this specific type of business actually needs`,
      },
    ],
  })

  tokenTracker.track('Site plan', {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })
  const raw = response.choices[0]?.message?.content || '{}'

  try {
    // Strip any markdown fences
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '')
    return JSON.parse(cleaned)
  } catch {
    console.log('[Generate] Failed to parse site plan, using fallback')
    return buildFallbackPlan(input)
  }
}

/** Generate design tokens from the brief */
async function generateDesignTokens(input: GenerateInput): Promise<DesignTokens> {
  const { clientContent, stylePreference } = input

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Generate a color palette and design tokens for a ${clientContent.industry || 'business'} website.

BUSINESS: ${clientContent.businessName}
STYLE: ${stylePreference || 'modern'}
INDUSTRY: ${clientContent.industry || 'general'}

Return a JSON object (no markdown, no explanation):
{
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "surface": "#hex",
    "text": "#hex",
    "textMuted": "#hex"
  },
  "fonts": {
    "heading": "Google Font name",
    "body": "Google Font name"
  },
  "borderRadius": "Npx",
  "style": "${stylePreference || 'modern'}"
}

Choose colors that are professional and appropriate for the industry.
Ensure sufficient contrast between text and background (WCAG AA).
Pick Google Fonts that match the style.`,
      },
    ],
  })

  tokenTracker.track('Design tokens', {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  })
  const raw = response.choices[0]?.message?.content || '{}'

  try {
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '')
    return JSON.parse(cleaned)
  } catch {
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
      style: stylePreference || 'modern',
    }
  }
}

/** Fallback site plan if Claude's response can't be parsed */
function buildFallbackPlan(input: GenerateInput): { pages: PageBlueprint[]; navigation: NavItem[] } {
  const name = input.clientContent.businessName

  return {
    pages: [
      {
        slug: '/',
        title: name,
        pageType: 'homepage',
        sections: [
          { type: 'hero', heading: name, content: input.clientContent.description },
          { type: 'features', heading: 'What We Offer' },
          { type: 'cta', heading: 'Get Started Today' },
        ],
        seo: { title: `${name} — ${input.clientContent.industry || 'Home'}`, description: input.clientContent.description },
        schema: [],
      },
      {
        slug: '/about',
        title: `About ${name}`,
        pageType: 'about',
        sections: [
          { type: 'text', heading: `About ${name}`, content: input.clientContent.description },
          { type: 'team', heading: 'Our Team' },
        ],
        seo: { title: `About ${name}`, description: `Learn more about ${name}` },
        schema: [],
      },
      {
        slug: '/contact',
        title: 'Contact Us',
        pageType: 'contact',
        sections: [
          { type: 'contact-form', heading: 'Get In Touch' },
        ],
        seo: { title: `Contact ${name}`, description: `Get in touch with ${name}` },
        schema: [],
      },
    ],
    navigation: [
      { label: 'Home', href: '/' },
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  }
}
