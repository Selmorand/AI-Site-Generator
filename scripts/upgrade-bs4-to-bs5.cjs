/**
 * Upgrade Bootstrap 4 HTML files to Bootstrap 5.
 * Handles class name changes and CDN link swaps.
 * Run: node scripts/upgrade-bs4-to-bs5.js <directory>
 */

const fs = require('fs');
const path = require('path');

const BS5_CSS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
const BS5_JS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';

// BS4 → BS5 class name replacements
const classReplacements = [
  // Spacing: ml/mr/pl/pr → ms/me/ps/pe
  [/\bml-([0-5]|auto)\b/g, 'ms-$1'],
  [/\bmr-([0-5]|auto)\b/g, 'me-$1'],
  [/\bpl-([0-5])\b/g, 'ps-$1'],
  [/\bpr-([0-5])\b/g, 'pe-$1'],
  // Float
  [/\bfloat-left\b/g, 'float-start'],
  [/\bfloat-right\b/g, 'float-end'],
  // Text alignment
  [/\btext-left\b/g, 'text-start'],
  [/\btext-right\b/g, 'text-end'],
  // Borders
  [/\bborder-left\b/g, 'border-start'],
  [/\bborder-right\b/g, 'border-end'],
  // Dropdowns
  [/\bdropleft\b/g, 'dropstart'],
  [/\bdropright\b/g, 'dropend'],
  // Badge
  [/\bbadge-pill\b/g, 'rounded-pill'],
  [/\bbadge-([a-z]+)\b/g, 'bg-$1 text-white'],
  // Close button
  [/\bclose\b(?=[^d-])/g, 'btn-close'],
  // Form
  [/\bform-group\b/g, 'mb-3'],
  [/\bform-row\b/g, 'row g-3'],
  [/\bcustom-control\b/g, 'form-check'],
  [/\bcustom-control-input\b/g, 'form-check-input'],
  [/\bcustom-control-label\b/g, 'form-check-label'],
  [/\bcustom-select\b/g, 'form-select'],
  [/\bcustom-file\b/g, 'form-control'],
  [/\bcustom-range\b/g, 'form-range'],
  // Font weight
  [/\bfont-weight-(\w+)\b/g, 'fw-$1'],
  [/\bfont-italic\b/g, 'fst-italic'],
  // Screen reader
  [/\bsr-only\b/g, 'visually-hidden'],
  [/\bsr-only-focusable\b/g, 'visually-hidden-focusable'],
  // Media
  [/\bmedia\b(?=[^-])/g, 'd-flex'],
  [/\bmedia-body\b/g, 'flex-grow-1'],
  // Jumbotron
  [/\bjumbotron\b/g, 'p-5 mb-4 bg-light rounded-3'],
  // No gutters
  [/\bno-gutters\b/g, 'g-0'],
];

// CDN replacements
const cdnReplacements = [
  // Replace BS4 CSS CDN links
  [/https?:\/\/[^"']*bootstrap[^"']*\.min\.css[^"']*/g, BS5_CSS],
  [/https?:\/\/[^"']*bootstrap[^"']*\.css[^"']*/g, BS5_CSS],
  // Replace BS4 JS CDN links
  [/https?:\/\/[^"']*bootstrap[^"']*\.bundle\.min\.js[^"']*/g, BS5_JS],
  [/https?:\/\/[^"']*bootstrap[^"']*\.min\.js[^"']*/g, BS5_JS],
  // Remove jQuery CDN (BS5 doesn't need it)
  // Don't remove — some templates use jQuery for other things
  // Remove Popper.js standalone (included in bundle)
  [/<script[^>]*popper[^>]*><\/script>\s*/gi, ''],
];

function upgradeFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let changes = 0;

  // Apply class replacements
  for (const [pattern, replacement] of classReplacements) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) changes++;
  }

  // Apply CDN replacements
  for (const [pattern, replacement] of cdnReplacements) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) changes++;
  }

  // Add data-bs- prefix to data attributes
  content = content.replace(/data-toggle=/g, 'data-bs-toggle=');
  content = content.replace(/data-target=/g, 'data-bs-target=');
  content = content.replace(/data-dismiss=/g, 'data-bs-dismiss=');
  content = content.replace(/data-backdrop=/g, 'data-bs-backdrop=');
  content = content.replace(/data-ride=/g, 'data-bs-ride=');
  content = content.replace(/data-slide=/g, 'data-bs-slide=');
  content = content.replace(/data-slide-to=/g, 'data-bs-slide-to=');
  content = content.replace(/data-parent=/g, 'data-bs-parent=');
  content = content.replace(/data-spy=/g, 'data-bs-spy=');
  content = content.replace(/data-offset=/g, 'data-bs-offset=');

  if (changes > 0) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  return changes;
}

function processDirectory(dir) {
  let totalFiles = 0;
  let totalChanges = 0;

  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.html')) {
        const changes = upgradeFile(full);
        if (changes > 0) {
          console.log(`  ${path.relative(dir, full)}: ${changes} changes`);
          totalChanges += changes;
        }
        totalFiles++;
      }
    }
  }

  walk(dir);
  console.log(`\nProcessed ${totalFiles} files, ${totalChanges} total changes.`);
}

// Run
const targetDir = process.argv[2];
if (!targetDir) {
  console.log('Usage: node upgrade-bs4-to-bs5.js <directory>');
  process.exit(1);
}

console.log(`Upgrading BS4 → BS5 in: ${targetDir}\n`);
processDirectory(targetDir);
