// Headless smoke test: load the app, verify the canvas renders non-blank
// pixels, exercise randomize + variations, capture screenshots.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.main-canvas', { timeout: 15000 });
await page.waitForTimeout(1500);

const analyze = async () =>
  page.evaluate(() => {
    const c = document.querySelector('.main-canvas');
    const t = document.createElement('canvas');
    t.width = 200;
    t.height = 200;
    const ctx = t.getContext('2d');
    ctx.drawImage(c, 0, 0, 200, 200);
    const d = ctx.getImageData(0, 0, 200, 200).data;
    let sum = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2] + d[i + 3];
      colors.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    }
    return { sum, distinctColors: colors.size };
  });

const first = await analyze();
console.log('initial render:', JSON.stringify(first));
await page.screenshot({ path: process.env.SHOT1 || 'shot1.png' });

// Randomize via the button and confirm pixels changed.
await page.click('button.primary:has-text("Randomize")');
await page.waitForTimeout(900);
const second = await analyze();
console.log('after randomize:', JSON.stringify(second));

// Variations drawer.
await page.click('button:has-text("Variations")');
await page.waitForTimeout(2500);
const thumbs = await page.locator('.variation-grid img').count();
console.log('variation thumbnails rendered:', thumbs);
await page.screenshot({ path: process.env.SHOT2 || 'shot2.png' });

const ok =
  first.sum > 0 &&
  (first.distinctColors > 1 && second.distinctColors > 3) &&
  second.sum !== first.sum &&
  thumbs >= 10 &&
  errors.length === 0;
console.log('console errors:', errors.length ? errors : 'none');
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
