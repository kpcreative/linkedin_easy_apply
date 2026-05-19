import { chromium } from 'playwright';
import * as path from 'path';

const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');

async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();

  // Navigate to jobs page
  await page.goto(
    'https://www.linkedin.com/jobs/search/?keywords=software+engineer&location=Berlin%2C+Germany&f_AL=true&sortBy=DD',
    { waitUntil: 'domcontentloaded', timeout: 25_000 }
  );
  await page.waitForTimeout(3_000);

  // Click the first job card
  const cards = await page.locator('li[data-occludable-job-id]').all();
  console.log('Cards:', cards.length);

  if (cards.length > 0) {
    await cards[0].click();
    await page.waitForTimeout(2_000);

    // Dump the detail panel HTML (right-side panel)
    const detailHtml = await page.locator('.jobs-search__job-details--wrapper, .jobs-details, [id^="job-details"]').first().innerHTML().catch(() => '');
    console.log('\n=== DETAIL PANEL HTML (2000 chars) ===');
    console.log(detailHtml.slice(0, 2000));

    // Find any button with "Easy Apply" text
    console.log('\n=== SEARCHING FOR EASY APPLY BUTTON ===');
    const allBtns = await page.locator('button').all();
    for (const btn of allBtns) {
      const t = (await btn.textContent().catch(() => ''))?.trim() ?? '';
      if (/easy\s*apply/i.test(t)) {
        const cls = await btn.getAttribute('class').catch(() => '');
        const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
        console.log(`  FOUND button: class="${cls}" aria-label="${ariaLabel}" text="${t.slice(0, 80)}"`);
      }
    }

    // Also check aria-label buttons
    const easyApplyBtns = await page.locator('button[aria-label*="Easy Apply" i], button[aria-label*="easy apply" i]').all();
    console.log(`\n  Buttons with aria-label containing "Easy Apply": ${easyApplyBtns.length}`);
    for (const btn of easyApplyBtns) {
      const cls = await btn.getAttribute('class').catch(() => '');
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
      console.log(`    aria-label="${ariaLabel}" class="${cls}"`);
    }

    // Check the title element structure
    console.log('\n=== TITLE ELEMENT STRUCTURE ===');
    const titleLinks = await page.locator('a.job-card-list__title--link').all();
    console.log(`title links found: ${titleLinks.length}`);
    if (titleLinks.length > 0) {
      const html = await titleLinks[0].innerHTML().catch(() => '');
      console.log(html.slice(0, 500));
    }
  }

  await page.waitForTimeout(5_000);
  await context.close();
}

main().catch(err => {
  console.error('Debug failed:', err.message);
  process.exit(1);
});
