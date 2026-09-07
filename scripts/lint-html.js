'use strict';
/* Extracts <script> blocks from HTML files (settings page, pair views, widgets) so ESLint can check them. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = ['settings', 'drivers', 'widgets'];
const out = path.join(__dirname, '..', '.lint-tmp');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((b) => b.trim());
      if (blocks.length) fs.writeFileSync(path.join(out, p.replace(/[\\/]/g, '__') + '.js'), blocks.join('\n\n'));
    }
  }
}
roots.forEach((r) => fs.existsSync(r) && walk(r));

try {
  execFileSync(process.env.ESLINT_BIN || path.join(__dirname, '..', 'node_modules', '.bin', 'eslint'), ['--no-ignore', out], { stdio: 'inherit' });
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
