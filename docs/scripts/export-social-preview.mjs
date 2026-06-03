/**
 * export-social-preview.mjs — Export social-preview.svg to PNG for GitHub Settings
 *
 * GitHub requires PNG format (1280×640) for the Social Preview image.
 * Uses @resvg/resvg-js (same renderer as website og-image generation).
 *
 * Usage (from project root): cd website && node ../docs/scripts/export-social-preview.mjs
 * Output: docs/social-preview.png
 *
 * After generating, upload to: GitHub → Settings → Social Preview
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const svgPath = resolve(PROJECT_ROOT, 'docs', 'social-preview.svg');
const pngPath = resolve(PROJECT_ROOT, 'docs', 'social-preview.png');

const svgContent = readFileSync(svgPath, 'utf-8');

const resvg = new Resvg(svgContent, {
  fitTo: {
    mode: 'width',
    value: 1280,
  },
  font: {
    defaultFontFamily: 'Arial',
  },
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();

writeFileSync(pngPath, pngBuffer);
console.log(`✅ Generated social-preview.png (${(pngBuffer.length / 1024).toFixed(1)} KB)`);
console.log(`   📐 Dimensions: 1280×640`);
console.log(`   📁 Output: docs/social-preview.png`);
console.log(`   📌 Next: Upload to GitHub → Settings → Social Preview`);
