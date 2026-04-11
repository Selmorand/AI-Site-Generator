/**
 * Client management — stores client data as a JSON file.
 * Each client has a site (output directory) and metadata.
 */

import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json')

export interface Client {
  id: string
  businessName: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  industry?: string
  description?: string
  logoUrl?: string
  faviconUrl?: string
  domain?: string              // custom domain or subdomain
  siteId?: string              // output folder name (links to generated site)
  template?: string            // which template was used
  plan: 'single' | 'multi'    // single page or multi-page
  pageCount: number
  monthlyFee: number           // calculated from plan + pages
  status: 'draft' | 'live' | 'paused'
  createdAt: string
  updatedAt: string
  notes?: string
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readClients(): Client[] {
  ensureDataDir()
  if (!fs.existsSync(CLIENTS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeClients(clients: Client[]) {
  ensureDataDir()
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8')
}

export function getAllClients(): Client[] {
  return readClients()
}

export function getClient(id: string): Client | undefined {
  return readClients().find(c => c.id === id)
}

export function createClient(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'monthlyFee'>): Client {
  const clients = readClients()
  const id = data.businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) + '-' + Date.now().toString(36)

  const monthlyFee = calculateFee(data.plan, data.pageCount)

  const client: Client = {
    ...data,
    id,
    monthlyFee,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  clients.push(client)
  writeClients(clients)
  return client
}

export function updateClient(id: string, updates: Partial<Client>): Client | null {
  const clients = readClients()
  const idx = clients.findIndex(c => c.id === id)
  if (idx === -1) return null

  clients[idx] = {
    ...clients[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  // Recalculate fee if plan or pages changed
  if (updates.plan || updates.pageCount) {
    clients[idx].monthlyFee = calculateFee(
      clients[idx].plan,
      clients[idx].pageCount
    )
  }

  writeClients(clients)
  return clients[idx]
}

export function deleteClient(id: string): boolean {
  const clients = readClients()
  const filtered = clients.filter(c => c.id !== id)
  if (filtered.length === clients.length) return false
  writeClients(filtered)
  return true
}

export function linkSiteToClient(clientId: string, siteId: string): Client | null {
  const clients = readClients()
  const client = clients.find(c => c.id === clientId)
  if (!client) return null

  // Count pages in the site
  const outputDir = path.resolve('./output', siteId)
  let pageCount = 0
  if (fs.existsSync(outputDir)) {
    const countHtml = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')) {
          countHtml(path.join(dir, e.name))
        } else if (e.name.endsWith('.html')) {
          pageCount++
        }
      }
    }
    countHtml(outputDir)
  }

  client.siteId = siteId
  client.pageCount = pageCount
  client.monthlyFee = calculateFee(client.plan, pageCount)
  client.updatedAt = new Date().toISOString()

  writeClients(clients)
  return client
}

function calculateFee(plan: string, pageCount: number): number {
  // R100 for first page, R10 per additional page
  if (pageCount <= 1) return 100
  return 100 + (pageCount - 1) * 10
}
