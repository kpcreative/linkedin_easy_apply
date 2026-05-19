import { chromium, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:3333';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

const bugs: string[] = [];
let passed = 0;

function log(msg: string) { console.log(msg); }
function pass(step: string) { passed++; log(`  ✅  ${step}`); }
function fail(step: string, detail: string) { bugs.push(`${step}: ${detail}`); log(`  ❌  ${step} — ${detail}`); }

/* Wait for the question label to show a specific text */
async function waitForQuestion(page: Page, expectedText: string, step: string): Promise<boolean> {
  try {
    // Use locator-based approach: wait for #question-label to contain the text
    await page.locator('#question-label', { hasText: expectedText }).waitFor({ timeout: 4000 });
    pass(step);
    return true;
  } catch {
    fail(step, `Label did not advance to "${expectedText}" within 4s`);
    return false;
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  log('\n🚀  Starting headed form walkthrough…');
  log(`    URL: ${BASE_URL}\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 350,  // slow enough to watch comfortably
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Capture JS console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      bugs.push(`JS console error: ${msg.text()}`);
      log(`  ⚠️   Console error: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    bugs.push(`Page error: ${err.message}`);
    log(`  ⚠️   Page error: ${err.message}`);
  });

  try {
    // ── Navigate ───────────────────────────────────────────
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#question-label', { timeout: 5000 });
    pass('Page loaded');

    // ── Q1: First name ─────────────────────────────────────
    await page.fill('.q-input', 'John');
    await page.press('.q-input', 'Enter');
    await waitForQuestion(page, "And your last name", 'Q1 → Q2 (first name → last name)');

    // ── Q2: Last name ──────────────────────────────────────
    await page.fill('.q-input', 'Smith');
    await page.press('.q-input', 'Enter');
    await waitForQuestion(page, 'Best phone number', 'Q2 → Q3 (last name → phone)');

    // ── Q3: Phone ──────────────────────────────────────────
    await page.fill('.q-input', '555-867-5309');
    await page.press('.q-input', 'Enter');
    await waitForQuestion(page, "What's your business", 'Q3 → Q4 (phone → business)');

    // ── Q4: Business name ──────────────────────────────────
    await page.fill('.q-input', 'Acme Corp');
    await page.press('.q-input', 'Enter');
    await waitForQuestion(page, 'What industry', 'Q4 → Q5 (business → industry)');

    // ── Q5: Industry (select) ──────────────────────────────
    await page.selectOption('.q-select', 'Technology & Software');
    await page.click('#continue-btn');
    await waitForQuestion(page, 'How large is your team', 'Q5 → Q6 (industry → team size)');

    // ── Q6: Company size (radio — auto-advances) ───────────
    await page.click('text=2–10 people');
    await waitForQuestion(page, 'annual revenue', 'Q6 → Q7 (team size → revenue)');

    // ── Q7: Revenue (radio — auto-advances) ───────────────
    await page.click('text=$100K – $500K');
    await waitForQuestion(page, 'biggest challenge', 'Q7 → Q8 (revenue → challenge)');

    // ── Q8: Primary challenge (textarea) ──────────────────
    await page.fill('.q-textarea', 'Scaling the sales process without burning out the team');
    await page.press('.q-textarea', 'Control+Enter');
    await waitForQuestion(page, 'success look like', 'Q8 → Q9 (challenge → goal)');

    // ── Q9: Primary goal (textarea) ────────────────────────
    await page.fill('.q-textarea', 'Double our customer base while maintaining quality');
    await page.press('.q-textarea', 'Control+Enter');
    await waitForQuestion(page, 'Which services', 'Q9 → Q10 (goal → services)');

    // ── Q10: Services (checkbox) ───────────────────────────
    await page.click('text=Strategy & Consulting');
    await page.click('text=Technology & Automation');
    await page.click('#continue-btn');
    await waitForQuestion(page, 'How did you hear', 'Q10 → Q11 (services → how heard)');

    // ── Q11: How heard (select) ────────────────────────────
    await page.selectOption('.q-select', 'Google Search');
    await page.click('#continue-btn');
    await waitForQuestion(page, "Anything else", 'Q11 → Q12 (how heard → anything else)');

    // ── Q12: Anything else (optional textarea) ─────────────
    await page.fill('.q-textarea', 'Looking forward to connecting with the team!');
    await page.press('.q-textarea', 'Control+Enter');

    // ── Summary screen ─────────────────────────────────────
    try {
      await page.waitForSelector('#summary-screen.active', { timeout: 4000 });
      const heading = await page.textContent('#summary-heading');
      if (heading?.includes('John')) {
        pass('Summary screen — heading includes first name "John"');
      } else {
        fail('Summary screen heading', `Expected "John", got "${heading}"`);
      }
    } catch {
      fail('Summary screen', 'Did not appear after Q12');
    }

    // ── Screenshot ─────────────────────────────────────────
    const screenshotPath = path.join(SCREENSHOTS_DIR, 'form-summary.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`\n  📸  Screenshot saved: ${screenshotPath}`);

    // ── Test back navigation ────────────────────────────────
    // Restart and test going back from Q2 to Q1
    log('\n  🔁  Testing back navigation…');
    await page.click('#restart-btn');
    await page.waitForSelector('#question-label', { timeout: 3000 });
    await page.fill('.q-input', 'Jane');
    await page.press('.q-input', 'Enter');
    await waitForQuestion(page, 'And your last name', 'Back nav setup — reached Q2');
    await page.click('#back-btn');
    await waitForQuestion(page, "What's your first name", 'Back nav — Q2 → Q1 via back button');

    // Check the value is restored (should still say 'Jane')
    const restoredVal = await page.inputValue('.q-input');
    if (restoredVal === 'Jane') {
      pass('Back nav — Q1 input value restored correctly ("Jane")');
    } else {
      fail('Back nav — value restore', `Expected "Jane", got "${restoredVal}"`);
    }

    // ── Validation test ─────────────────────────────────────
    log('\n  🔍  Testing validation…');
    await page.fill('.q-input', '');
    await page.press('.q-input', 'Enter');
    const errorVisible = await page.isVisible('#error-msg.visible');
    if (errorVisible) {
      pass('Validation — empty first name shows error');
    } else {
      fail('Validation', 'Empty submit did not show error message');
    }

  } finally {
    // Print bug report
    log('\n' + '─'.repeat(50));
    log(`  Results: ✅ ${passed} passed  |  ❌ ${bugs.length} bug(s) found`);
    if (bugs.length > 0) {
      log('\n  Bugs:');
      bugs.forEach((b, i) => log(`    ${i + 1}. ${b}`));
    } else {
      log('  No bugs found! 🎉');
    }
    log('─'.repeat(50) + '\n');

    // Leave browser open for a moment so user can see summary
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

main().catch(err => {
  console.error('\nScript failed:', err);
  process.exit(1);
});
