/**
 * Diagnostic: inspect the reviews page DOM to find the correct selectors.
 * Run: npx ts-node scripts/amazon-reviews-debug.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ASIN = 'B0DZX7CN7T'; // Nike Revolution 8 from previous run

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
    const url = `https://www.amazon.com/product-reviews/${ASIN}?sortBy=recent&reviewerType=all_reviews`;
    console.log('Opening:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);

    const ss = path.join(__dirname, '..', 'screenshots', 'amazon-reviews-debug.png');
    fs.mkdirSync(path.dirname(ss), { recursive: true });
    await page.screenshot({ path: ss, fullPage: false });
    console.log('Screenshot:', ss);

    // Check what selectors exist on the review page
    const candidates: Record<string, number> = {};
    for (const sel of [
      '[data-hook="review"]',
      '[data-hook="review-body"]',
      '.review',
      '.review-views',
      '[id^="customer_review"]',
      '[id^="review-"]',
      '.a-section.review',
      'div[data-review-id]',
      '.cr-widget-desktop .a-section',
      '.reviews-content .review',
    ]) {
      candidates[sel] = await page.locator(sel).count();
    }
    console.log('\nSelector counts on reviews page:', JSON.stringify(candidates, null, 2));

    // Dump the first few data-hook values present on the page
    const hooks = await page.$$eval(
      '[data-hook]',
      (els: any[]) => [...new Set(els.map((e: any) => e.getAttribute('data-hook')))].slice(0, 40)
    );
    console.log('\ndata-hook values found:', hooks);

    // Dump page title to see if we hit a redirect
    console.log('\nPage title:', await page.title());
    console.log('Page URL:', page.url());

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
