/**
 * API routes for the dashboard.
 */

import { Router } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import OpenAI from 'openai'
import { runJob, isJobRunning } from './job-runner.js'
import { tokenTracker } from '../token-tracker.js'
import type { Request, Response } from 'express'

const router = Router()

/**
 * POST /api/generate — start a generation job and stream SSE events.
 */
router.post('/generate', (req: Request, res: Response) => {
  const { mode, ...params } = req.body

  if (!mode || !['generate', 'rebuild', 'clone'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode. Must be generate, rebuild, or clone.' })
    return
  }

  if (isJobRunning()) {
    res.status(409).json({ error: 'A generation is already in progress. Please wait.' })
    return
  }

  // Validate required fields
  if (mode === 'generate') {
    if (!params.name || !params.description || !params.brief) {
      res.status(400).json({ error: 'Generate mode requires name, description, and brief.' })
      return
    }
  } else if (mode === 'rebuild') {
    if (!params.url) {
      res.status(400).json({ error: 'Rebuild mode requires url.' })
      return
    }
  } else if (mode === 'clone') {
    if (!params.inspirationUrl || !params.name || !params.description) {
      res.status(400).json({ error: 'Clone mode requires inspirationUrl, name, and description.' })
      return
    }
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // Disable request timeout for long-running generation
  req.setTimeout(0)

  const sendEvent = (event: { type: string; data: Record<string, unknown> }) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
  }

  // Run job asynchronously
  runJob(mode, params, sendEvent).then(() => {
    res.end()
  }).catch(() => {
    res.end()
  })

  // Handle client disconnect
  req.on('close', () => {
    // Job continues running even if client disconnects
  })
})

/**
 * GET /api/jobs — list past generation jobs.
 */
router.get('/jobs', (_req: Request, res: Response) => {
  const outputDir = path.resolve('./output')
  if (!fs.existsSync(outputDir)) {
    res.json([])
    return
  }

  const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const stat = fs.statSync(path.join(outputDir, e.name))
      return { id: e.name, created: stat.birthtime }
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime())

  res.json(entries)
})

/**
 * DELETE /api/jobs/:id — delete a generated site.
 */
router.delete('/jobs/:id', (req: Request, res: Response) => {
  const id = (req.params as any).id as string
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    res.status(400).json({ error: 'Invalid job ID' })
    return
  }
  const jobDir = path.resolve('./output', id)
  if (!fs.existsSync(jobDir)) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  fs.rmSync(jobDir, { recursive: true, force: true })
  res.json({ success: true })
})

/**
 * GET /api/template/:name — serve a template CSS file for live preview swapping.
 */
router.get('/template/:name', (req: Request, res: Response) => {
  const name = (req.params.name as string).replace(/[^a-z0-9-]/gi, '')
  const cssPath = path.resolve(process.cwd(), 'src', 'assets', 'templates', `${name}.css`)
  if (!fs.existsSync(cssPath)) {
    res.status(404).send('Template not found')
    return
  }
  res.type('text/css').send(fs.readFileSync(cssPath, 'utf-8'))
})

/**
 * POST /api/save-design — save template/colours/fonts to a generated site's output
 */
router.post('/save-design', (req: Request, res: Response) => {
  const { jobId, template, colors, fonts } = req.body
  if (!jobId) {
    res.status(400).json({ error: 'jobId required' })
    return
  }

  const outputDir = path.resolve('./output', jobId)
  if (!fs.existsSync(outputDir)) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  // Copy template CSS
  if (template) {
    const tplPath = path.resolve(process.cwd(), 'src', 'assets', 'templates', `${template}.css`)
    if (fs.existsSync(tplPath)) {
      fs.copyFileSync(tplPath, path.join(outputDir, 'template.css'))
    }
  }

  // Generate new theme.css with custom colours/fonts
  if (colors || fonts) {
    const c = colors || {}
    const f = fonts || { heading: 'Inter', body: 'Open Sans' }
    const headingFont = f.heading || 'Inter'
    const bodyFont = f.body || 'Open Sans'

    const themeCss = `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFont)}:wght@400;500;600;700;800&family=${encodeURIComponent(bodyFont)}:wght@400;500;600;700&display=swap');

:root {
  --color-primary: ${c.primary || '#1e40af'};
  --color-primary-dark: ${adjustHex(c.primary || '#1e40af', -20)};
  --color-primary-light: ${adjustHex(c.primary || '#1e40af', 40)};
  --color-secondary: ${c.secondary || '#0891b2'};
  --color-secondary-dark: ${adjustHex(c.secondary || '#0891b2', -20)};
  --color-accent: ${c.accent || '#f59e0b'};
  --color-accent-dark: ${adjustHex(c.accent || '#f59e0b', -20)};
  --color-bg: ${c.background || '#ffffff'};
  --color-surface: ${c.surface || '#f8fafc'};
  --color-text: ${c.text || '#1e293b'};
  --color-text-muted: ${c.textMuted || '#64748b'};
  --font-heading: '${headingFont}', sans-serif;
  --font-body: '${bodyFont}', sans-serif;
}
`
    fs.writeFileSync(path.join(outputDir, 'theme.css'), themeCss, 'utf-8')
  }

  res.json({ success: true })
})

/**
 * POST /api/edit-page — edit a page using chat instruction
 */
router.post('/edit-page', async (req: Request, res: Response) => {
  const { jobId, pagePath, instruction } = req.body
  if (!jobId || !instruction) {
    res.status(400).json({ error: 'jobId and instruction required' })
    return
  }

  // Resolve page file
  const subPath = pagePath || ''
  const outputDir = path.resolve('./output', jobId)
  let htmlFile = path.join(outputDir, subPath, 'index.html')
  if (subPath === '' || subPath === '/') {
    htmlFile = path.join(outputDir, 'index.html')
  }
  if (!fs.existsSync(htmlFile)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  const currentHtml = fs.readFileSync(htmlFile, 'utf-8')

  try {
    const client = new OpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: `Here is the current HTML of a web page. Apply the following change and return the COMPLETE modified HTML. Do not explain, just return the full HTML.

INSTRUCTION: ${instruction}

CURRENT HTML:
${currentHtml}

Return ONLY the complete modified HTML, no markdown fences, no explanation.`,
        },
      ],
    })

    tokenTracker.track('Edit page', {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    })

    let newHtml = response.choices[0]?.message?.content || ''
    newHtml = newHtml.replace(/^```html?\n?/m, '').replace(/\n?```$/m, '')

    if (!newHtml.includes('<!DOCTYPE') && !newHtml.includes('<html')) {
      res.status(500).json({ error: 'LLM did not return valid HTML' })
      return
    }

    fs.writeFileSync(htmlFile, newHtml, 'utf-8')
    res.json({
      success: true,
      tokens: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * POST /api/edit-all-pages — edit all pages in a site using the same instruction
 */
router.post('/edit-all-pages', async (req: Request, res: Response) => {
  const { jobId, instruction } = req.body
  if (!jobId || !instruction) {
    res.status(400).json({ error: 'jobId and instruction required' })
    return
  }

  const outputDir = path.resolve('./output', jobId)
  if (!fs.existsSync(outputDir)) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  // Find all HTML files
  const htmlFiles: string[] = []
  function findHtml(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) findHtml(full)
      else if (entry.name === 'index.html') htmlFiles.push(full)
    }
  }
  findHtml(outputDir)

  // Set SSE headers for streaming progress
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  req.setTimeout(0)

  const client = new OpenAI()
  let totalInput = 0
  let totalOutput = 0
  let edited = 0
  let errors = 0

  for (const htmlFile of htmlFiles) {
    const pageName = path.relative(outputDir, htmlFile).replace(/\\/g, '/').replace(/\/index\.html$/, '') || 'home'
    res.write(`event: progress\ndata: ${JSON.stringify({ message: `Editing ${pageName}...` })}\n\n`)

    try {
      const currentHtml = fs.readFileSync(htmlFile, 'utf-8')
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 16000,
        messages: [
          {
            role: 'user',
            content: `Here is the current HTML of a web page. Apply the following change and return the COMPLETE modified HTML. Do not explain, just return the full HTML.

INSTRUCTION: ${instruction}

CURRENT HTML:
${currentHtml}

Return ONLY the complete modified HTML, no markdown fences, no explanation.`,
          },
        ],
      })

      totalInput += response.usage?.prompt_tokens ?? 0
      totalOutput += response.usage?.completion_tokens ?? 0

      let newHtml = response.choices[0]?.message?.content || ''
      newHtml = newHtml.replace(/^```html?\n?/m, '').replace(/\n?```$/m, '')

      if (newHtml.includes('<!DOCTYPE') || newHtml.includes('<html')) {
        fs.writeFileSync(htmlFile, newHtml, 'utf-8')
        edited++
        res.write(`event: progress\ndata: ${JSON.stringify({ message: `  ✓ ${pageName} updated` })}\n\n`)
      } else {
        errors++
        res.write(`event: progress\ndata: ${JSON.stringify({ message: `  ✗ ${pageName} — invalid response` })}\n\n`)
      }
    } catch (err) {
      errors++
      res.write(`event: progress\ndata: ${JSON.stringify({ message: `  ✗ ${pageName} — ${(err as Error).message}` })}\n\n`)
    }
  }

  res.write(`event: complete\ndata: ${JSON.stringify({ edited, errors, tokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput } })}\n\n`)
  res.end()
})

/**
 * GET /api/jobs/:id/images — list all images used in a generated site
 */
router.get('/jobs/:id/images', (req: Request, res: Response) => {
  const id = (req.params as any).id as string
  const outputDir = path.resolve('./output', id)
  if (!fs.existsSync(outputDir)) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  const images: { src: string; alt: string; page: string; type: 'img' | 'bg' }[] = []

  // Scan all HTML files
  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(full)
      } else if (entry.name.endsWith('.html')) {
        const html = fs.readFileSync(full, 'utf-8')
        const pagePath = path.relative(outputDir, full).replace(/\\/g, '/').replace(/\/index\.html$/, '') || 'index'

        // Find <img> tags
        const imgRegex = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi
        let match
        while ((match = imgRegex.exec(html)) !== null) {
          images.push({ src: match[1], alt: match[2], page: pagePath, type: 'img' })
        }

        // Find background-image styles
        const bgRegex = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi
        while ((match = bgRegex.exec(html)) !== null) {
          images.push({ src: match[1], alt: '', page: pagePath, type: 'bg' })
        }
      }
    }
  }

  scanDir(outputDir)
  res.json(images)
})

/**
 * POST /api/jobs/:id/replace-image — replace an image URL across all HTML files
 */
router.post('/jobs/:id/replace-image', (req: Request, res: Response) => {
  const id = (req.params as any).id as string
  const { oldSrc, newSrc } = req.body
  if (!oldSrc || !newSrc) {
    res.status(400).json({ error: 'oldSrc and newSrc required' })
    return
  }

  const outputDir = path.resolve('./output', id)
  if (!fs.existsSync(outputDir)) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  let replacements = 0

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(full)
      } else if (entry.name.endsWith('.html')) {
        let html = fs.readFileSync(full, 'utf-8')
        const count = (html.split(oldSrc).length - 1)
        if (count > 0) {
          html = html.split(oldSrc).join(newSrc)
          fs.writeFileSync(full, html, 'utf-8')
          replacements += count
        }
      }
    }
  }

  scanDir(outputDir)
  res.json({ success: true, replacements })
})

function adjustHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export default router
