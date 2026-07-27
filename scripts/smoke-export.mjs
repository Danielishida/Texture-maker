// Export smoke test: full-res worker export (PNG) + vector-safe SVG export.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.main-canvas');
await page.waitForTimeout(1000);

// --- raster export (worker, tiled path exercised via 1x on 4000x3000 doc) ---
await page.click('button.primary.export');
await page.waitForSelector('.modal');
await page.selectOption('.modal select', 'png');
const dl = page.waitForEvent('download', { timeout: 120000 });
await page.click('.modal button.primary:has-text("Export current")');
const download = await dl;
const path = await download.path();
const { statSync } = await import('node:fs');
const size = statSync(path).size;
console.log('raster export:', download.suggestedFilename(), size, 'bytes');
const rasterOk = /\.png$/.test(download.suggestedFilename()) && size > 100000;

// --- SVG export in vector-safe mode ---
await page.waitForTimeout(500);
await page.click('.topbar label:has-text("vector-safe") input');
await page.waitForTimeout(500);
await page.click('button.primary.export');
await page.waitForSelector('.modal');
const dl2 = page.waitForEvent('download', { timeout: 30000 });
await page.click('.modal button:has-text("Export SVG")');
const svgDownload = await dl2;
const svgPath = await svgDownload.path();
const { readFileSync } = await import('node:fs');
const svg = readFileSync(svgPath, 'utf8');
console.log('svg export:', svgDownload.suggestedFilename(), svg.length, 'chars');
const svgOk = svg.startsWith('<svg') && svg.includes('</svg>') && !svg.includes('NaN');

console.log('console errors:', errors.length ? errors : 'none');
const ok = rasterOk && svgOk && errors.length === 0;
console.log(ok ? 'EXPORT SMOKE OK' : 'EXPORT SMOKE FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
