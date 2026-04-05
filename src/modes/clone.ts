/**
 * Clone Mode — crawl an inspiration site for layout/design,
 * then swap in the client's own content.
 */

import { crawlAndExtract } from '../crawler/extract.js'
import { downloadAssets } from '../crawler/download-assets.js'
import { generateSite } from '../generator/generate-site.js'
import type { SiteBlueprint, CloneInput, PageBlueprint } from '../types/blueprint.js'
import { tokenTracker } from '../token-tracker.js'

export async function clone(input: CloneInput, outputDir: string) {
  console.log(`\n[Clone] Crawling inspiration site: ${input.inspirationUrl}...`)

  // Step 1: Crawl the inspiration site for structure and design
  const crawlResult = await crawlAndExtract({
    url: input.inspirationUrl,
    maxPages: 15,
    extractDesign: true,
  })

  console.log(`[Clone] Extracted ${crawlResult.pages.length} pages from inspiration`)
  console.log(`[Clone] Design style: ${crawlResult.design.style}`)

  // Step 2: Download assets from inspiration (for layout reference)
  const { assets } = await downloadAssets(crawlResult.assets, outputDir)

  // Step 3: Merge — keep inspiration's structure/design, use client's content
  const clientContent = input.clientContent

  // Map inspiration pages to client pages with swapped content
  const mergedPages: PageBlueprint[] = crawlResult.pages.map((inspirationPage) => {
    // Check if client provided content for this page type
    const clientPage = clientContent.pages?.find(
      (p) => p.pageType === inspirationPage.pageType || p.slug === inspirationPage.slug
    )

    return {
      ...inspirationPage,
      // Override title with client's business name where appropriate
      title: clientPage?.title || inspirationPage.title.replace(
        crawlResult.meta.businessName,
        clientContent.businessName
      ),
      // Keep inspiration's section structure but clear content for Claude to fill
      sections: inspirationPage.sections.map((section) => ({
        ...section,
        // Keep section type and layout, but mark content for replacement
        content: clientPage
          ? undefined  // Claude will generate from client brief
          : section.content,
        heading: section.heading?.replace(
          crawlResult.meta.businessName,
          clientContent.businessName
        ),
      })),
      seo: {
        title: `${clientContent.businessName} — ${inspirationPage.pageType}`,
        description: clientContent.description || inspirationPage.seo.description,
      },
      schema: [], // Will be regenerated for client
    }
  })

  // Step 4: Build blueprint with client's identity + inspiration's structure
  const blueprint: SiteBlueprint = {
    mode: 'clone',
    meta: {
      businessName: clientContent.businessName,
      tagline: clientContent.tagline,
      industry: clientContent.industry,
      description: clientContent.description,
      logoUrl: clientContent.logoUrl,
      contactEmail: clientContent.contactEmail,
      contactPhone: clientContent.contactPhone,
      address: clientContent.address,
      socialLinks: clientContent.socialLinks,
    },
    design: crawlResult.design, // Keep inspiration's design
    pages: mergedPages,
    navigation: crawlResult.navigation.map((nav) => ({
      ...nav,
      label: nav.label, // Keep structure, labels stay generic (Home, About, etc.)
    })),
    assets,
  }

  // Step 5: Generate
  console.log(`[Clone] Generating site for ${clientContent.businessName}...`)
  const result = await generateSite(blueprint, outputDir)

  console.log(`[Clone] Done! Generated ${result.pages.length} pages`)
  if (result.errors.length > 0) {
    console.log(`[Clone] Errors: ${result.errors.join(', ')}`)
  }

  tokenTracker.printSummary()

  return result
}
