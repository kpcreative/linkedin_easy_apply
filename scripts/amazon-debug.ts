/**
 * Diagnostic: dump Amazon search page HTML and take a screenshot so
 * we can see the real DOM selectors in use today.
 * Run: npx ts-node scripts/amazon-debug.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

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
    await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const searchBox = page.getByRole('searchbox', { name: /search/i });
    await searchBox.fill('Nike shoes');
    await searchBox.press('Enter');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000); // let lazy JS settle

    // Take screenshot
    const ss = path.join(__dirname, '..', 'screenshots', 'amazon-search-debug.png');
    fs.mkdirSync(path.dirname(ss), { recursive: true });
    await page.screenshot({ path: ss, fullPage: false });
    console.log('Screenshot saved:', ss);

    // Dump first 300 product-link candidates
    const links = await page.$$eval(
      'a[href*="/dp/"], a[href*="/gp/product/"]',
      (els) => (els as any[]).slice(0, 20).map((a: any) => ({
        text: (a.textContent as string)?.trim().slice(0, 80),
        href: a.href as string,
      }))
    );
    console.log('\nProduct links found:', JSON.stringify(links, null, 2));

    // Check what data-component-type values exist
    const compTypes = await page.$$eval(
      '[data-component-type]',
      (els) => [...new Set(els.map((e) => e.getAttribute('data-component-type')))]
    );
    console.log('\ndata-component-type values present:', compTypes);

    // Check if there are any h2 a elements inside result cards
    const h2Count = await page.locator('[data-component-type="s-search-result"] h2 a').count();
    console.log('\n[data-component-type="s-search-result"] h2 a count:', h2Count);

    // Try broader product-title selectors
    const counts: Record<string, number> = {};
    for (const sel of [
      '.s-result-item h2 a',
      '.sg-col-inner h2 a',
      '[data-asin] h2 a',
      '[data-asin] a.a-link-normal',
    ]) {
      counts[sel] = await page.locator(sel).count();
    }
    console.log('\nAlternative selector counts:', counts);

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
