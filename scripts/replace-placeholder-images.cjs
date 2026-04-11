/**
 * Replace placeholder image files (grey "1920x900" type images) with Picsum photos.
 * Detects placeholders by file size patterns and image content.
 * Run: node scripts/replace-placeholder-images.cjs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'site-templates');
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// Keywords for varied Picsum images
const KEYWORDS = [
  'business', 'office', 'team', 'city', 'technology', 'meeting',
  'workspace', 'building', 'handshake', 'laptop', 'conference',
  'architecture', 'design', 'creative', 'professional', 'corporate',
  'modern', 'abstract', 'nature', 'skyline', 'interior', 'people',
  'marketing', 'finance', 'startup', 'developer', 'construction',
  'restaurant', 'food', 'health', 'education', 'travel', 'fitness',
  'consulting', 'industry', 'logistics', 'retail', 'automotive',
];

let counter = 0;

async function main() {
  const templateDirs = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => d.name);

  for (const tplName of templateDirs) {
    console.log(`\n=== ${tplName} ===`);
    const tplDir = path.join(TEMPLATES_DIR, tplName);
    await processDir(tplDir);
  }

  console.log(`\nDone! Replaced ${counter} placeholder images.`);
}

async function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      await processDir(full);
    } else if (entry.isFile() && IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
      if (isPlaceholder(full)) {
        await replaceWithPicsum(full);
      }
    }
  }
}

function isPlaceholder(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const buf = fs.readFileSync(filePath);

    // Skip very large files (real high-res photos)
    if (stats.size > 500000) return false;

    // Check binary content for dimension text patterns
    const str = buf.toString('latin1');
    if (str.match(/\d{3,4}\s*[x×]\s*\d{3,4}/)) return true;

    // Check for very low colour variance (grey/solid placeholders)
    // Placeholder images are mostly one colour — real photos have variety
    if (stats.size < 100000) {
      // Sample some bytes — if they're all very similar, it's a placeholder
      const sampleSize = Math.min(buf.length, 1000);
      const startOffset = Math.floor(buf.length * 0.3); // skip headers
      let sum = 0;
      let sumSq = 0;
      const n = Math.min(sampleSize, buf.length - startOffset);
      for (let i = 0; i < n; i++) {
        const v = buf[startOffset + i];
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / n;
      const variance = (sumSq / n) - (mean * mean);
      // Very low variance = solid/near-solid colour = placeholder
      if (variance < 200) return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function replaceWithPicsum(filePath) {
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Guess dimensions from filename or use defaults
  let width = 800, height = 600;
  const dimMatch = filePath.match(/(\d{3,4})[x_-](\d{2,4})/i);
  if (dimMatch) {
    width = parseInt(dimMatch[1]);
    height = parseInt(dimMatch[2]);
  } else if (filePath.match(/slide|slider|banner|hero/i)) {
    width = 1920; height = 900;
  } else if (filePath.match(/team|person|avatar|profile/i)) {
    width = 400; height = 400;
  } else if (filePath.match(/thumb|small|icon/i)) {
    width = 300; height = 300;
  } else if (filePath.match(/blog|post|article/i)) {
    width = 800; height = 500;
  }

  // Cap dimensions for download speed
  width = Math.min(width, 1920);
  height = Math.min(height, 1080);

  const keyword = KEYWORDS[counter % KEYWORDS.length];
  const url = `https://picsum.photos/seed/${keyword}${counter}/${width}/${height}`;
  counter++;

  console.log(`  Replacing: ${path.basename(filePath)} → ${width}x${height} (${keyword})`);

  try {
    const data = await downloadUrl(url);
    fs.writeFileSync(filePath, data);
  } catch (err) {
    console.log(`    Failed: ${err.message}`);
  }
}

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 15000 }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('timeout')); });
  });
}

main().catch(console.error);
