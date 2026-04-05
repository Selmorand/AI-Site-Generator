/**
 * Asset Downloader — downloads images, fonts, and other assets
 * to the local output directory for the generated site.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { lookup } from 'mime-types'
import type { AssetRef } from '../types/blueprint.js'

interface DownloadResult {
  assets: AssetRef[]
  errors: string[]
}

export async function downloadAssets(
  assets: AssetRef[],
  outputDir: string
): Promise<DownloadResult> {
  const assetsDir = path.join(outputDir, 'assets')
  await fs.mkdir(path.join(assetsDir, 'images'), { recursive: true })
  await fs.mkdir(path.join(assetsDir, 'fonts'), { recursive: true })

  const results: AssetRef[] = []
  const errors: string[] = []

  for (const asset of assets) {
    try {
      const response = await fetch(asset.originalUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AISiteGenerator/1.0)' },
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        errors.push(`${asset.originalUrl}: HTTP ${response.status}`)
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const ext = guessExtension(asset.originalUrl, response.headers.get('content-type'))
      const filename = sanitizeFilename(asset.originalUrl) + ext

      const subdir = asset.type === 'font' ? 'fonts' : 'images'
      const localPath = path.join('assets', subdir, filename)
      const fullPath = path.join(outputDir, localPath)

      await fs.writeFile(fullPath, buffer)

      results.push({
        ...asset,
        localPath,
      })
    } catch (err) {
      errors.push(`${asset.originalUrl}: ${(err as Error).message}`)
    }
  }

  return { assets: results, errors }
}

function guessExtension(url: string, contentType: string | null): string {
  // Try from URL path first
  const urlPath = new URL(url).pathname
  const urlExt = path.extname(urlPath).split('?')[0]
  if (urlExt && urlExt.length <= 5) return urlExt

  // Try from content-type
  if (contentType) {
    const mimeExt = lookup(contentType)
    if (mimeExt) return `.${mimeExt}`
  }

  return '.bin'
}

function sanitizeFilename(url: string): string {
  const urlPath = new URL(url).pathname
  const basename = path.basename(urlPath, path.extname(urlPath))
  // Remove non-alphanumeric chars, truncate
  return basename
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 50)
    || 'asset'
}
