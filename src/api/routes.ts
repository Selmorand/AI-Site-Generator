/**
 * API routes for the dashboard.
 */

import { Router } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { runJob, isJobRunning } from './job-runner.js'
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

export default router
