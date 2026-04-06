#!/usr/bin/env node

/**
 * AI Site Generator CLI
 *
 * Usage:
 *   npx tsx src/cli.ts rebuild --url https://example.com --output ./output/example
 *   npx tsx src/cli.ts clone --inspiration https://nice-site.com --name "My Biz" --output ./output/mybiz
 *   npx tsx src/cli.ts generate --name "My Biz" --industry "plumbing" --brief "A local plumber in Cape Town" --output ./output/mybiz
 */

import { Command } from 'commander'
import * as path from 'path'
import * as fs from 'fs/promises'
import { rebuild } from './modes/rebuild.js'
import { clone } from './modes/clone.js'
import { generate } from './modes/generate.js'

const program = new Command()

program
  .name('ai-site-generator')
  .description('AI-powered static site generator — rebuild, clone, or create from scratch')
  .version('0.1.0')

// --- Rebuild Mode ---
program
  .command('rebuild')
  .description('Crawl an existing site and regenerate it as optimized static HTML')
  .requiredOption('--url <url>', 'URL of the site to rebuild')
  .option('--output <dir>', 'Output directory', './output')
  .option('--max-pages <n>', 'Maximum pages to crawl', '20')
  .option('--auditor-key <key>', 'AI Readiness Auditor API key (for fix-aware rebuilds)')
  .action(async (opts) => {
    const outputDir = path.resolve(opts.output)
    await fs.mkdir(outputDir, { recursive: true })

    await rebuild(
      {
        url: opts.url,
        maxPages: parseInt(opts.maxPages) || 20,
      },
      outputDir
    )

    console.log(`\n✓ Site generated at: ${outputDir}`)
    console.log(`  Open ${path.join(outputDir, 'index.html')} in a browser to preview.`)
  })

// --- Clone Mode ---
program
  .command('clone')
  .description("Clone an inspiration site's design, swap in client content")
  .requiredOption('--inspiration <url>', 'URL of the site to clone layout from')
  .requiredOption('--name <name>', 'Client business name')
  .requiredOption('--description <desc>', 'Client business description')
  .option('--industry <industry>', 'Client industry')
  .option('--phone <phone>', 'Contact phone')
  .option('--email <email>', 'Contact email')
  .option('--address <address>', 'Business address')
  .option('--output <dir>', 'Output directory', './output')
  .action(async (opts) => {
    const outputDir = path.resolve(opts.output)
    await fs.mkdir(outputDir, { recursive: true })

    await clone(
      {
        mode: 'clone',
        inspirationUrl: opts.inspiration,
        clientContent: {
          businessName: opts.name,
          description: opts.description,
          industry: opts.industry,
          contactPhone: opts.phone,
          contactEmail: opts.email,
          address: opts.address,
        },
      },
      outputDir
    )

    console.log(`\n✓ Site generated at: ${outputDir}`)
    console.log(`  Open ${path.join(outputDir, 'index.html')} in a browser to preview.`)
  })

// --- Generate Mode ---
program
  .command('generate')
  .description('Generate a new site from scratch based on a text brief')
  .requiredOption('--name <name>', 'Business name')
  .requiredOption('--description <desc>', 'Business description')
  .requiredOption('--brief <brief>', 'What the site should achieve / contain')
  .option('--industry <industry>', 'Business industry')
  .option('--style <style>', 'Design style: modern, classic, minimal, bold, playful', 'modern')
  .option('--phone <phone>', 'Contact phone')
  .option('--email <email>', 'Contact email')
  .option('--address <address>', 'Business address')
  .option('--output <dir>', 'Output directory', './output')
  .action(async (opts) => {
    const outputDir = path.resolve(opts.output)
    await fs.mkdir(outputDir, { recursive: true })

    await generate(
      {
        mode: 'generate',
        brief: opts.brief,
        clientContent: {
          businessName: opts.name,
          description: opts.description,
          industry: opts.industry,
          contactPhone: opts.phone,
          contactEmail: opts.email,
          address: opts.address,
        },
        stylePreference: opts.style,
      },
      outputDir
    )

    console.log(`\n✓ Site generated at: ${outputDir}`)
    console.log(`  Open ${path.join(outputDir, 'index.html')} in a browser to preview.`)
  })

program.parse()
