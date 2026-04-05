/**
 * Express server for the AI Site Generator dashboard.
 */

import express from 'express'
import * as path from 'path'
import { fileURLToPath } from 'url'
import apiRoutes from './api/routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = parseInt(process.env.PORT || '3500', 10)

// Parse JSON bodies
app.use(express.json())

// Serve dashboard
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'))
})

// API routes
app.use('/api', apiRoutes)

// Serve generated site previews: /preview/<jobId>/...
app.use('/preview/:jobId', (req, res, next) => {
  const jobId = req.params.jobId
  // Prevent path traversal
  if (jobId.includes('..') || jobId.includes('/') || jobId.includes('\\')) {
    res.status(400).send('Invalid job ID')
    return
  }
  const jobDir = path.resolve('./output', jobId)
  express.static(jobDir)(req, res, next)
})

app.listen(PORT, () => {
  console.log(`\n  AI Site Generator Dashboard`)
  console.log(`  http://localhost:${PORT}\n`)
})
