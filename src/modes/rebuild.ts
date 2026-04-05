/**
 * Rebuild Mode — crawl client's existing site, extract blueprint, generate new site.
 */

import { crawlAndExtract } from '../crawler/extract.js'
import { downloadAssets } from '../crawler/download-assets.js'
import { generateSite } from '../generator/generate-site.js'
import type { SiteBlueprint, RebuildInput } from '../types/blueprint.js'
import { tokenTracker } from '../token-tracker.js'

export async function rebuild(input: RebuildInput, outputDir: string) {
  console.log(`\n[Rebuild] Crawling ${input.url}...`)

  // Step 1: Crawl and extract
  const crawlResult = await crawlAndExtract({
    url: input.url,
    maxPages: 20,
    extractDesign: true,
  })

  console.log(`[Rebuild] Extracted ${crawlResult.pages.length} pages, ${crawlResult.assets.length} assets`)
  console.log(`[Rebuild] Business: ${crawlResult.meta.businessName}`)
  console.log(`[Rebuild] Navigation: ${crawlResult.navigation.map((n) => n.label).join(', ')}`)

  // Step 2: Download assets
  console.log(`[Rebuild] Downloading assets...`)
  const { assets, errors: assetErrors } = await downloadAssets(crawlResult.assets, outputDir)
  if (assetErrors.length > 0) {
    console.log(`[Rebuild] ${assetErrors.length} assets failed to download`)
  }

  // Step 3: Build blueprint
  const blueprint: SiteBlueprint = {
    mode: 'rebuild',
    meta: crawlResult.meta,
    design: crawlResult.design,
    pages: crawlResult.pages,
    navigation: crawlResult.navigation,
    assets,
  }

  // Step 4: Generate
  console.log(`[Rebuild] Generating site with Claude...`)
  const result = await generateSite(blueprint, outputDir)

  console.log(`[Rebuild] Done! Generated ${result.pages.length} pages`)
  if (result.errors.length > 0) {
    console.log(`[Rebuild] Errors: ${result.errors.join(', ')}`)
  }

  tokenTracker.printSummary()

  return result
}
