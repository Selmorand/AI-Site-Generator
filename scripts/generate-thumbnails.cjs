/**
 * Generate thumbnail screenshots of all templates using Playwright.
 * Produces a thumbnails/ directory and a catalogue.json file.
 * Run: node scripts/generate-thumbnails.cjs
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'site-templates');
const THUMBS_DIR = path.resolve(__dirname, '..', 'site-templates', '_thumbnails');
const CATALOGUE_PATH = path.resolve(__dirname, '..', 'site-templates', 'catalogue.json');

async function main() {
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const catalogue = [];
  const templateDirs = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => d.name);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  for (const tplName of templateDirs) {
    const tplDir = path.join(TEMPLATES_DIR, tplName);

    // Find all index/home HTML files
    const htmlFiles = findHtmlFiles(tplDir, tplDir);

    for (const htmlFile of htmlFiles) {
      const relPath = path.relative(tplDir, htmlFile).replace(/\\/g, '/');
      const thumbName = `${tplName}--${relPath.replace(/[\/\\]/g, '--').replace('.html', '')}.png`;
      const thumbPath = path.join(THUMBS_DIR, thumbName);

      // Skip if thumbnail already exists
      if (fs.existsSync(thumbPath)) {
        catalogue.push({
          template: tplName,
          file: relPath,
          thumbnail: `_thumbnails/${thumbName}`,
          name: formatName(relPath, tplName),
        });
        continue;
      }

      console.log(`  Screenshotting: ${tplName}/${relPath}`);

      try {
        const page = await context.newPage();
        await page.goto(`file:///${htmlFile.replace(/\\/g, '/')}`, {
          waitUntil: 'networkidle',
          timeout: 15000,
        });
        await page.waitForTimeout(1000);

        // Replace placeholder images with Picsum photos
        await page.evaluate(function() {
          var counter = 0;
          // Replace <img> placeholders
          document.querySelectorAll('img').forEach(function(img) {
            var src = img.getAttribute('src') || '';
            var w = img.naturalWidth || img.width || 600;
            var h = img.naturalHeight || img.height || 400;
            // Detect placeholder patterns
            if (src.match(/placehold|placeholder|via\.placeholder|dummyimage|fakeimg|picsum|lorempixel/i) ||
                src.match(/\d+x\d+/) ||
                !src || src === '#' ||
                img.naturalWidth === 0) {
              counter++;
              img.src = 'https://picsum.photos/seed/tpl' + counter + '/' + Math.max(w, 300) + '/' + Math.max(h, 200);
            }
          });
          // Replace background-image placeholders
          document.querySelectorAll('[style]').forEach(function(el) {
            var style = el.getAttribute('style') || '';
            if (style.match(/background-image/) && style.match(/placehold|placeholder|via\.placeholder|\d+x\d+/i)) {
              counter++;
              el.style.backgroundImage = "url('https://picsum.photos/seed/bg" + counter + "/1600/800')";
            }
          });
        });
        await page.waitForTimeout(2000); // Wait for Picsum images to load

        await page.screenshot({
          path: thumbPath,
          clip: { x: 0, y: 0, width: 1440, height: 900 },
        });

        await page.close();

        catalogue.push({
          template: tplName,
          file: relPath,
          thumbnail: `_thumbnails/${thumbName}`,
          name: formatName(relPath, tplName),
        });
      } catch (err) {
        console.log(`    Failed: ${err.message}`);
      }
    }
  }

  await browser.close();

  // Write catalogue
  fs.writeFileSync(CATALOGUE_PATH, JSON.stringify(catalogue, null, 2));
  console.log(`\nGenerated ${catalogue.length} thumbnails → catalogue.json`);
}

function findHtmlFiles(dir, rootDir, depth = 0) {
  const results = [];
  if (depth > 2) return results; // Don't go too deep

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'admin-template' && entry.name !== 'documentation') {
      results.push(...findHtmlFiles(full, rootDir, depth + 1));
    } else if (entry.name.match(/^(index|home)[^.]*\.html$/) && depth <= 2) {
      results.push(full);
    }
  }
  return results;
}

function formatName(relPath, tplName) {
  let name = relPath
    .replace(/\.html$/, '')
    .replace(/^index$/, 'Home')
    .replace(/^home-/, 'Home ')
    .replace(/^index-/, '')
    .replace(/-/g, ' ')
    .replace(/\//g, ' — ');

  // Capitalise words
  name = name.replace(/\b\w/g, l => l.toUpperCase());

  return `${tplName}: ${name}`;
}

main().catch(console.error);
