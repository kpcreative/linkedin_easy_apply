/**
 * amazon-nike-reviews.ts
 *
 * Opens Amazon in a HEADED browser, searches for "best Nike shoes",
 * navigates to the first product result, scrapes the top reviews,
 * and writes them to data/nike-reviews.json.
 *
 * Run:  npx ts-node scripts/amazon-nike-reviews.ts
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'nike-reviews.json');

interface Review {
  author: string;
  rating: string;
  title: string;
  date: string;
  verifiedPurchase: boolean;
  body: string;
}

interface ScrapeResult {
  scrapedAt: string;
  productTitle: string;
  productUrl: string;
  averageRating: string;
  totalRatings: string;
  reviews: Review[];
  bugs: string[];
}

async function run(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const bugs: string[] = [];

  // ------------------------------------------------------------------
  // Launch headed browser so the user can watch
  // ------------------------------------------------------------------
  const browser = await chromium.launch({
    headless: false,
    slowMo: 120,        // slight slow-down so it is watchable
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,     // null = use the OS window size (maximized above)
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // ------------------------------------------------------------------
    // 1. Go to Amazon
    // ------------------------------------------------------------------
    console.log('[1/6] Navigating to Amazon.com...');
    await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Dismiss sign-in pop-up if it appears
    const dismissBtn = page.locator('[data-action="a-modal-close"]').first();
    if (await dismissBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dismissBtn.click();
    }

    // ------------------------------------------------------------------
    // 2. Search for "best Nike shoes"
    // ------------------------------------------------------------------
    console.log('[2/6] Searching for "best Nike shoes"...');
    const searchBox = page.getByRole('searchbox', { name: /search/i });
    await searchBox.fill('best Nike shoes');
    await searchBox.press('Enter');
    await page.waitForLoadState('load');

    // ------------------------------------------------------------------
    // 3. Find the first product result — single fast locator, no loops
    // ------------------------------------------------------------------
    console.log('[3/6] Finding the first product result...');

    // Wait for at least one result card to be present
    await page
      .locator('[data-component-type="s-search-result"]')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {
        bugs.push('BUG: Search result cards never appeared — Amazon may be showing a CAPTCHA or bot-check page.');
      });

    // Grab the first product /dp/ link directly — h2 a no longer exists in Amazon's current DOM
    let productLink: string | null = null;
    const firstProductAnchor = page
      .locator('a[href*="/dp/"]')
      .first();

    const href = await firstProductAnchor.getAttribute('href', { timeout: 10_000 }).catch(() => null);
    if (href) {
      // Strip query string — keep just https://www.amazon.com/dp/ASIN/...
      const full = href.startsWith('http') ? href : `https://www.amazon.com${href}`;
      productLink = full.replace(/\?.*$/, '');
    }

    if (!productLink) {
      bugs.push('BUG: No product link found — Amazon DOM structure may have changed.');
    }

    if (!productLink) {
      bugs.push('BUG: No product link found at all. Amazon may have changed its DOM structure.');
      throw new Error('No product link could be extracted from search results.');
    }

    console.log(`   Product URL: ${productLink}`);

    // ------------------------------------------------------------------
    // 4. Navigate to the product page
    // ------------------------------------------------------------------
    console.log('[4/6] Opening product page...');
    await page.goto(productLink, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Grab title and aggregate ratings
    const productTitle = await page
      .locator('#productTitle')
      .textContent()
      .then((t) => t?.trim() ?? 'Unknown')
      .catch(() => {
        bugs.push('BUG: Could not read #productTitle — selector may have changed.');
        return 'Unknown';
      });

    const averageRating = await page
      .locator('[data-hook="rating-out-of-text"], .a-icon-alt')
      .first()
      .textContent()
      .then((t) => t?.trim() ?? 'N/A')
      .catch(() => 'N/A');

    const totalRatings = await page
      .locator('#acrCustomerReviewText')
      .first()
      .textContent()
      .then((t) => t?.trim() ?? 'N/A')
      .catch(() => 'N/A');

    console.log(`   Title: ${productTitle}`);
    console.log(`   Rating: ${averageRating}  (${totalRatings})`);

    // ------------------------------------------------------------------
    // 5. Scroll the product page to load the inline "Top reviews" widget
    //    (navigating to /product-reviews/ requires a login — the product
    //     page itself renders up to 13 reviews without authentication)
    // ------------------------------------------------------------------
    console.log('[5/6] Scrolling to load inline reviews on the product page...');

    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await page.waitForTimeout(1500); // let lazy-loaded review widgets settle

    // ------------------------------------------------------------------
    // 6. Extract the inline reviews
    // ------------------------------------------------------------------
    console.log('[6/6] Extracting reviews...');

    await page
      .locator('[data-hook="review"]')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {
        bugs.push(
          'BUG: Timed out waiting for [data-hook="review"] on the product page — Amazon may have changed its layout.'
        );
      });

    const reviews: Review[] = [];
    const reviewCards = await page.locator('[data-hook="review"]').all();

    if (reviewCards.length === 0) {
      bugs.push('BUG: Zero review cards found on the product page.');
    }

    for (const card of reviewCards.slice(0, 20)) {
      const author = await card
        .locator('.a-profile-name, [data-hook="genome-widget"] span')
        .first()
        .textContent()
        .then((t) => t?.trim() ?? 'Anonymous')
        .catch(() => 'Anonymous');

      const ratingText = await card
        .locator('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt')
        .first()
        .textContent()
        .then((t) => t?.trim() ?? 'N/A')
        .catch(() => 'N/A');

      const title = await card
        .locator('[data-hook="review-title"] span:not(.a-icon-alt)')
        .first()
        .textContent()
        .then((t) => t?.trim() ?? '')
        .catch(() => '');

      const date = await card
        .locator('[data-hook="review-date"]')
        .first()
        .textContent()
        .then((t) => t?.trim() ?? '')
        .catch(() => '');

      const verifiedPurchase = await card
        .locator('[data-hook="avp-badge"]')
        .isVisible()
        .catch(() => false);

      const body = await card
        .locator('[data-hook="review-body"] span')
        .first()
        .textContent()
        .then((t) => t?.trim() ?? '')
        .catch(() => '');

      reviews.push({ author, rating: ratingText, title, date, verifiedPurchase, body });
    }

    console.log(`   Extracted ${reviews.length} reviews.`);

    // ------------------------------------------------------------------
    // Save results
    // ------------------------------------------------------------------
    const result: ScrapeResult = {
      scrapedAt: new Date().toISOString(),
      productTitle,
      productUrl: productLink,
      averageRating,
      totalRatings,
      reviews,
      bugs,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\nDone! Results written to: ${OUTPUT_FILE}`);

    if (bugs.length > 0) {
      console.warn('\n--- Bugs / Issues Noted ---');
      bugs.forEach((b) => console.warn(' ', b));
    } else {
      console.log('No bugs encountered.');
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
