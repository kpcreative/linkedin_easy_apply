/**
 * Diagnostic: inspect the product page for review selectors rendered inline.
 * Run: npx ts-node scripts/amazon-product-reviews-debug.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PRODUCT_URL = 'https://www.amazon.com/Nike-Revolution-Sneaker-Anthracite-X-Wide/dp/B0DZX7CN7T';

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  try {
    console.log('Opening product page...');
    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Scroll all the way down to trigger lazy-loaded review widgets
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await page.waitForTimeout(3000);

    const ss = path.join(__dirname, '..', 'screenshots', 'amazon-product-reviews-debug.png');
    fs.mkdirSync(path.dirname(ss), { recursive: true });
    await page.screenshot({ path: ss, fullPage: true });
    console.log('Screenshot:', ss);

    // Probe selectors
    const candidates: Record<string, number> = {};
    for (const sel of [
      '[data-hook="review"]',
      '[id^="customer_review"]',
      '[data-hook="reviews-medley-footer"]',
      '#reviews-medley-footer',
      '#cm_cr-review_list',
      '.review',
      '[data-hook="top-customer-reviews"]',
      '[data-hook="review-list"]',
      'div[data-reftag]',
      '[data-hook="review-collapsed"]',
    ]) {
      candidates[sel] = await page.locator(sel).count();
    }
    console.log('\nSelector counts on product page:', JSON.stringify(candidates, null, 2));

    // All data-hook values
    const hooks = await page.$$eval(
      '[data-hook]',
      (els: any[]) => [...new Set(els.map((e: any) => e.getAttribute('data-hook')))].slice(0, 60)
    );
    console.log('\ndata-hook values:', hooks);

    console.log('\nPage URL:', page.url());
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
