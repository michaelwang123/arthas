/**
 * Temporary script to verify meta tags on sample pages.
 * Checks: title, canonical, hreflang (en, zh), og:image, twitter:card
 */
import { readFileSync } from 'node:fs';

const pages = [
  'dist/index.html',
  'dist/download/index.html',
  'dist/roadmap/index.html',
  'dist/zh/index.html',
  'dist/zh/download/index.html',
  'dist/zh/roadmap/index.html',
  'dist/getting-started/index.html',
  'dist/zh/getting-started/index.html',
];

let allPass = true;

for (const p of pages) {
  const c = readFileSync(p, 'utf-8');
  const hasCanonical = /<link[^>]*rel=["']canonical["'][^>]*>/.test(c);
  const hasHreflangEn = /<link[^>]*hreflang=["']en["'][^>]*>/.test(c);
  const hasHreflangZh = /<link[^>]*hreflang=["']zh(?:-CN)?["'][^>]*>/.test(c);
  const hasXDefault = /<link[^>]*hreflang=["']x-default["'][^>]*>/.test(c);
  const hasOgImage = /og:image/.test(c);
  const hasTwitterCard = /twitter:card/.test(c);
  const hasTitle = /<title>[^<]+<\/title>/.test(c);
  const hasDescription = /<meta\s+name=["']description["']\s+content=["'][^"']+["']/.test(c);

  const checks = { hasTitle, hasCanonical, hasHreflangEn, hasHreflangZh, hasXDefault, hasOgImage, hasTwitterCard };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

  if (failed.length === 0) {
    console.log(`✅ ${p}`);
  } else {
    console.log(`⚠️  ${p} — missing: ${failed.join(', ')}`);
    // Only fail on critical checks (not x-default for Starlight pages)
    const critical = failed.filter(f => f !== 'hasXDefault' && f !== 'hasDescription');
    if (critical.length > 0) allPass = false;
  }
}

if (!allPass) {
  console.log('\n❌ Some pages are missing critical meta tags');
  process.exit(1);
} else {
  console.log('\n✅ All sample pages have required meta tags');
}
