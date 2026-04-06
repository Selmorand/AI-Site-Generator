/**
 * Express server for the AI Site Generator dashboard.
 */

import 'dotenv/config'
import express from 'express'
import * as path from 'path'
import apiRoutes from './api/routes.js'

const srcDir = path.resolve(process.cwd(), 'src')

const app = express()
const PORT = parseInt(process.env.PORT || '3500', 10)

import multer from 'multer'

// Parse JSON bodies
app.use(express.json())

// Serve uploaded assets (logos, favicons)
app.use('/uploads', express.static(path.resolve('./uploads')))

// File upload for logos/favicons
const upload = multer({
  dest: path.resolve('./uploads'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only images allowed'))
  },
})

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }
  // Rename to keep extension
  const ext = path.extname(req.file.originalname) || '.png'
  const newName = req.file.filename + ext
  const newPath = path.join(path.resolve('./uploads'), newName)
  fs.renameSync(req.file.path, newPath)
  res.json({ url: `/uploads/${newName}`, filename: newName })
})

// Serve dashboard
app.get('/', (_req, res) => {
  res.sendFile(path.join(srcDir, 'dashboard', 'index.html'))
})

// API routes
app.use('/api', apiRoutes)

// Serve template CSS files for live preview swapping
import * as fs from 'fs'
app.get('/templates/:file', (req, res) => {
  const file = (req.params as any).file.replace(/[^a-z0-9.-]/gi, '')
  const filePath = path.join(srcDir, 'assets', 'templates', file)
  if (!fs.existsSync(filePath)) {
    res.status(404).send('Not found')
    return
  }
  res.type('text/css').sendFile(filePath)
})

// Serve generated site previews: /preview/<jobId>/...
// Injects a <base> tag into HTML files so relative paths always resolve from /preview/jobId/
function servePreview(req: express.Request, res: express.Response) {
  const jobId = (req.params as any).jobId
  if (jobId.includes('..') || jobId.includes('\\')) {
    res.status(400).send('Invalid job ID')
    return
  }
  const pathParts: string[] = (req.params as any).path || []
  const subPath = Array.isArray(pathParts) ? pathParts.join('/') : (pathParts || '')
  const filePath = path.resolve('./output', jobId, subPath || '.')

  // Find the file to serve
  let targetFile: string | null = null
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const indexFile = path.join(filePath, 'index.html')
    if (fs.existsSync(indexFile)) targetFile = indexFile
  } else if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    targetFile = filePath
  } else {
    const withIndex = path.join(filePath, 'index.html')
    if (fs.existsSync(withIndex)) targetFile = withIndex
  }

  if (!targetFile) {
    res.status(404).send('Not found')
    return
  }

  // For HTML files, inject <base> tag and rewrite relative paths to work with it
  if (targetFile.endsWith('.html')) {
    let html = fs.readFileSync(targetFile, 'utf-8')
    const baseTag = `<base href="/preview/${jobId}/">`

    // Rewrite all ../ prefixes in href and src attributes to ./ since <base> sets the root
    html = html.replace(/(href|src)="(\.\.\/)+/gi, '$1="./');

    // Insert <base> after <head>
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n${baseTag}`)
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', `<HEAD>\n${baseTag}`)
    } else {
      html = baseTag + '\n' + html
    }
    res.type('html').send(html)
  } else {
    res.sendFile(targetFile)
  }
}

app.get('/preview/:jobId/*path', servePreview)
app.get('/preview/:jobId', servePreview)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AI Site Generator Dashboard`)
  console.log(`  http://localhost:${PORT}\n`)
})
