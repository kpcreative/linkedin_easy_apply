import { chromium, Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DentalClinic {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: string;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCREENSHOTS_DIR  = path.join(__dirname, '..', 'screenshots');
const RESULTS_JSON     = path.join(SCREENSHOTS_DIR, 'dentist-results.json');
const PROFILE_DIR      = path.join(__dirname, '..', '.chrome-profile');
const SEARCH_QUERY     = 'dentists near me';
const TARGET_PHONES    = 10;   // keep clicking until we have this many phone numbers
const MAX_CLICK_ATTEMPTS = 20; // safety cap on detail clicks

// Phone-number pattern — used to reject phone text landing in the address field
const PHONE_RE = /^[\+\d][\d\s\-\(\)\.]{6,}$/;

// ─── Logging helpers ─────────────────────────────────────────────────────────

function log(msg: string): void  { console.log(msg); }
function warn(msg: string): void { console.warn(msg); }

// ─── Screenshot helper ────────────────────────────────────────────────────────

async function capture(page: Page, name: string): Promise<void> {
  const p = path.join(SCREENSHOTS_DIR, `dentist-${name}.png`);
  try {
    await page.screenshot({ path: p, fullPage: true });
    log(`  [screenshot] saved: dentist-${name}.png`);
  } catch (err) {
    warn(`  [screenshot] FAILED to save dentist-${name}.png: ${(err as Error).message}`);
  }
}

// ─── Safe filename ────────────────────────────────────────────────────────────

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
}

// ─── Text extraction with multi-selector fallback ─────────────────────────────

async function tryText(
  page: Page,
  selectors: string[],
  fieldName: string,
  clinic: DentalClinic
): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        const text = (await el.textContent({ timeout: 2000 }))?.trim() ?? '';
        if (text.length > 0) return text;
      }
    } catch { /* selector not present, try next */ }
  }
  clinic.errors.push(`missing: ${fieldName}`);
  return null;
}

// ─── Attribute extraction with fallback ───────────────────────────────────────

async function tryAttr(
  page: Page,
  selectors: string[],
  attr: string,
  fieldName: string,
  clinic: DentalClinic
): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        const val = (await el.getAttribute(attr, { timeout: 2000 }))?.trim() ?? '';
        if (val.length > 0) return val;
      }
    } catch { /* try next */ }
  }
  clinic.errors.push(`missing: ${fieldName}`);
  return null;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseRating(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

function parseReviewCount(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[(),\s]/g, '');
  const m = cleaned.match(/(\d[\d,]*)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

// ─── Consent/popup dismissal ──────────────────────────────────────────────────

async function dismissConsentDialogs(page: Page): Promise<void> {
  const dismissSelectors = [
    'button[aria-label*="Accept all"]',
    'button[aria-label*="Reject all"]',
    'button:has-text("Accept all")',
    'button:has-text("Reject all")',
    'button:has-text("I agree")',
    '#L2AGLb',
    '#W0wltc',
    '[aria-label="Accept cookies"]',
    'button:has-text("Accept cookies")',
  ];
  for (const sel of dismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1200 })) {
        await btn.click();
        log(`  [consent] Dismissed dialog: ${sel}`);
        await page.waitForTimeout(600);
        return;
      }
    } catch { /* not present */ }
  }
  // Escape dismisses sign-in overlays silently
  try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
}

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

async function checkForCaptcha(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/sorry/') || url.includes('recaptcha')) {
    warn('\n  ┌─────────────────────────────────────────────────────────────┐');
    warn('  │  CAPTCHA / Bot-check detected in the browser window!        │');
    warn('  │  Please solve the "I\'m not a robot" challenge manually.     │');
    warn('  │  The script will wait up to 90 seconds for you to do so.    │');
    warn('  └─────────────────────────────────────────────────────────────┘\n');

    // Poll every 2 seconds until the /sorry/ URL is gone (max 90s)
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      if (!currentUrl.includes('/sorry/') && !currentUrl.includes('recaptcha')) {
        log('  [captcha] Solved! Continuing...');
        return true;
      }
    }
    warn('  [captcha] Timed out waiting for CAPTCHA to be solved. Continuing with partial data.');
    return true;
  }
  return false;
}

// ─── Phase 1: Extract local pack cards from Google search results ─────────────

async function extractLocalPackClinics(page: Page): Promise<DentalClinic[]> {
  const clinics: DentalClinic[] = [];

  // Container selectors — primary, then fallbacks
  const containerSelectors = [
    '.VkpGBb',
    '.rllt__details',
    '[data-attrid*="dentists"] .dbg0pd',
    '.uMdZh.tIxNaf',   // another known local pack card class
  ];

  let containerSel = '';
  for (const sel of containerSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) { containerSel = sel; break; }
    } catch { /* try next */ }
  }

  if (!containerSel) {
    warn('  [local-pack] No local pack cards found on search results page.');
    return clinics;
  }

  const cards = page.locator(containerSel);
  const count = Math.min(await cards.count(), 3);
  log(`  [local-pack] Found ${await cards.count()} cards using "${containerSel}", extracting up to ${count}`);

  for (let i = 0; i < count; i++) {
    const clinic: DentalClinic = {
      name: '', phone: null, address: null, website: null,
      rating: null, reviewCount: null,
      source: page.url(), errors: [],
    };
    const card = cards.nth(i);

    // Name
    const nameSelectors = [
      '.dbg0pd', '.OSrXXb', '.rllt__wrapped-text span', 'h3 span', '.cXedhc',
    ];
    for (const sel of nameSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          const t = (await el.textContent())?.trim() ?? '';
          if (t.length > 0) { clinic.name = t; break; }
        }
      } catch { /* try next */ }
    }
    if (!clinic.name) {
      // Last resort: first text content of the card
      clinic.name = (await card.textContent())?.trim().split('\n')[0] ?? `Clinic ${i + 1}`;
    }

    // Rating
    const ratingSelectors = [
      '.MW4etd', 'span[aria-label*="stars"]', '.yi40Hd', '.fTKmx',
    ];
    for (const sel of ratingSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          // Try aria-label first (more reliable)
          const ariaLabel = await el.getAttribute('aria-label') ?? '';
          const text = (await el.textContent())?.trim() ?? '';
          const raw = ariaLabel || text;
          const parsed = parseRating(raw);
          if (parsed !== null) { clinic.rating = parsed; break; }
        }
      } catch { /* try next */ }
    }

    // Review count
    const reviewSelectors = ['.UY7F9', 'span[aria-label*="reviews"]', '.RDApEe'];
    for (const sel of reviewSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          const ariaLabel = await el.getAttribute('aria-label') ?? '';
          const text = (await el.textContent())?.trim() ?? '';
          const raw = ariaLabel || text;
          const parsed = parseReviewCount(raw);
          if (parsed !== null) { clinic.reviewCount = parsed; break; }
        }
      } catch { /* try next */ }
    }

    // Address (partial, from card)
    const addressSelectors = ['.W4Etrd', '.Io6YTe', '.rllt__details span:last-child'];
    for (const sel of addressSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          const t = (await el.textContent())?.trim() ?? '';
          if (t.length > 0) { clinic.address = t; break; }
        }
      } catch { /* try next */ }
    }
    if (!clinic.address) clinic.errors.push('missing: address');

    if (clinic.name) {
      log(`  [local-pack] #${i + 1}: ${clinic.name} | rating: ${clinic.rating ?? 'n/a'} | reviews: ${clinic.reviewCount ?? 'n/a'}`);
      clinics.push(clinic);
    }
  }

  return clinics;
}

// ─── Phase 2: Click "More places" to navigate to Google Maps ─────────────────

async function clickMorePlaces(page: Page, context: BrowserContext): Promise<Page> {
  const morePlacesSelectors = [
    'a:has-text("More places")',
    'a:has-text("More dentists")',
    'a:has-text("More businesses")',
    '.HbEOT',
    'a[href*="maps.google"]',
    'a[href*="google.com/maps"]',
  ];

  // Listen for a new tab that might open
  const newPagePromise = new Promise<Page | null>(resolve => {
    const timer = setTimeout(() => resolve(null), 3000);
    context.once('page', (newPage) => {
      clearTimeout(timer);
      resolve(newPage);
    });
  });

  for (const sel of morePlacesSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        log(`  [maps-nav] Clicking "${sel}" to open Google Maps...`);
        await el.click();

        // Check if a new tab opened
        const newPage = await newPagePromise;
        if (newPage) {
          await newPage.waitForLoadState('domcontentloaded', { timeout: 20000 });
          log(`  [maps-nav] Opened in new tab: ${newPage.url()}`);
          return newPage;
        }

        // Otherwise wait for current page to navigate to Maps
        try {
          await page.waitForURL(/maps\.google|google\.com\/maps/, { timeout: 20000 });
          log(`  [maps-nav] Navigated to: ${page.url()}`);
          return page;
        } catch {
          warn('  [maps-nav] waitForURL timed out, checking current URL...');
          if (/maps/.test(page.url())) return page;
        }
        break;
      }
    } catch { /* try next */ }
  }

  warn('  [maps-nav] Could not find "More places" link. Staying on search results.');
  return page;
}

// ─── Phase 3: Extract clinic list from Google Maps panel ─────────────────────

async function scrollMapsList(page: Page): Promise<void> {
  const panelSelectors = [
    '.m6QErb[aria-label]',
    '[role="feed"]',
    '.DxyBCb',
    '.ecceSd',
  ];
  for (const sel of panelSelectors) {
    try {
      const panel = page.locator(sel).first();
      if (await panel.count() > 0) {
        log('  [maps-scroll] Scrolling list panel to load more results...');
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await panel.evaluate((el) => (el as any).scrollBy(0, 600));
          await page.waitForTimeout(800);
        }
        return;
      }
    } catch { /* try next */ }
  }
  // Fallback: scroll the page
  await page.evaluate(() => { (globalThis as typeof globalThis & { scrollBy: (x: number, y: number) => void }).scrollBy(0, 1200); });
}

async function extractMapsListClinics(page: Page): Promise<DentalClinic[]> {
  const clinics: DentalClinic[] = [];

  // Wait for cards to appear
  let cardsFound = false;
  const cardContainerSelectors = ['.Nv2PK', '.bfdHYd', '[jsaction*="mouseover"] .lI9IFe'];
  let usedContainerSel = '';
  for (const sel of cardContainerSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 12000 });
      usedContainerSel = sel;
      cardsFound = true;
      break;
    } catch { /* try next */ }
  }

  if (!cardsFound) {
    warn('  [maps-list] Could not find Maps list cards.');
    return clinics;
  }

  const cards = page.locator(usedContainerSel);
  const total = await cards.count();
  log(`  [maps-list] Found ${total} cards using "${usedContainerSel}"`);

  const seenNames = new Set<string>();

  for (let i = 0; i < total; i++) {
    const clinic: DentalClinic = {
      name: '', phone: null, address: null, website: null,
      rating: null, reviewCount: null,
      source: page.url(), errors: [],
    };
    const card = cards.nth(i);

    // Name
    const nameSelectors = ['.qBF1Pd', '.fontHeadlineSmall', 'h3', '[aria-label]'];
    for (const sel of nameSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          // For [aria-label], use attribute; otherwise textContent
          let t = '';
          if (sel === '[aria-label]') {
            t = (await el.getAttribute('aria-label'))?.trim() ?? '';
          } else {
            t = (await el.textContent())?.trim() ?? '';
          }
          if (t.length > 0 && !t.includes('·') && !t.startsWith('http')) {
            clinic.name = t;
            break;
          }
        }
      } catch { /* try next */ }
    }

    if (!clinic.name) continue;
    if (seenNames.has(clinic.name)) continue; // deduplicate
    seenNames.add(clinic.name);

    // Rating
    const ratingSelectors = ['.MW4etd', 'span[aria-label*="stars"]', '.fTKmx'];
    for (const sel of ratingSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          const ariaLabel = await el.getAttribute('aria-label') ?? '';
          const text = (await el.textContent())?.trim() ?? '';
          const parsed = parseRating(ariaLabel || text);
          if (parsed !== null) { clinic.rating = parsed; break; }
        }
      } catch { /* try next */ }
    }

    // Review count
    const reviewSelectors = ['.UY7F9', 'span[aria-label*="review"]', '.e4rVHe'];
    for (const sel of reviewSelectors) {
      try {
        const el = card.locator(sel).first();
        if (await el.count() > 0) {
          const ariaLabel = await el.getAttribute('aria-label') ?? '';
          const text = (await el.textContent())?.trim() ?? '';
          const parsed = parseReviewCount(ariaLabel || text);
          if (parsed !== null) { clinic.reviewCount = parsed; break; }
        }
      } catch { /* try next */ }
    }
    if (clinic.reviewCount === null) clinic.errors.push('missing: reviewCount');

    // Address / details rows — skip text that looks like a phone number
    const addressSelectors = [
      '.W4Etrd',
      '.Io6YTe.fontBodyMedium',
      '.UsdlK',
      '[data-item-id*="address"] span',
    ];
    for (const sel of addressSelectors) {
      try {
        // Get ALL matching elements in the card; pick the first one that is NOT a phone
        const els = card.locator(sel);
        const elCount = await els.count();
        for (let j = 0; j < elCount; j++) {
          const t = (await els.nth(j).textContent())?.trim() ?? '';
          if (t.length > 0 && !PHONE_RE.test(t)) {
            clinic.address = t;
            break;
          }
        }
        if (clinic.address) break;
      } catch { /* try next */ }
    }
    if (!clinic.address) clinic.errors.push('missing: address');

    log(`  [maps-list] #${clinics.length + 1}: ${clinic.name} | ${clinic.rating ?? 'n/a'}★ (${clinic.reviewCount ?? 'n/a'})`);
    clinics.push(clinic);
  }

  return clinics;
}

// ─── Phase 4: Click into each listing to get phone + website ─────────────────

async function extractDetailPanel(page: Page, clinic: DentalClinic, index: number): Promise<void> {
  log(`\n  [detail] Clicking into: ${clinic.name}`);

  // Find and click the card by name
  const cardSelectors = ['.Nv2PK', '.bfdHYd'];
  let clicked = false;

  for (const containerSel of cardSelectors) {
    try {
      const cards = page.locator(containerSel);
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const nameEl = card.locator('.qBF1Pd, .fontHeadlineSmall, h3').first();
        if (await nameEl.count() > 0) {
          const cardName = (await nameEl.textContent())?.trim() ?? '';
          if (cardName.toLowerCase().includes(clinic.name.toLowerCase().slice(0, 15)) ||
              clinic.name.toLowerCase().includes(cardName.toLowerCase().slice(0, 15))) {
            await card.click({ timeout: 5000 });
            clicked = true;
            break;
          }
        }
      }
    } catch { /* try next */ }
    if (clicked) break;
  }

  if (!clicked) {
    warn(`  [detail] Could not click card for: ${clinic.name}`);
    clinic.errors.push('detail_click_failed');
    return;
  }

  // Wait for detail panel
  const detailPanelSelectors = [
    '[data-panel-id="place-panel"]',
    '.rogA2c',
    '.m6QErb.DxyBCb',
    '.PPCwl',
  ];
  let panelVisible = false;
  for (const sel of detailPanelSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 8000 });
      panelVisible = true;
      break;
    } catch { /* try next */ }
  }

  if (!panelVisible) {
    warn(`  [detail] Detail panel did not appear for: ${clinic.name}`);
    clinic.errors.push('detail_panel_not_found');
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    return;
  }

  await page.waitForTimeout(1000); // let dynamic content settle

  // Verify name in detail panel — scope to panel container to avoid matching page-level h1="Results"
  const panelContainerSelectors = [
    '[data-panel-id="place-panel"]',
    '.rogA2c',
    '.m6QErb.DxyBCb',
    '.PPCwl',
    'body', // final fallback
  ];
  let panelRoot = page.locator('body');
  for (const sel of panelContainerSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && sel !== 'body') { panelRoot = el; break; }
    } catch { /* try next */ }
  }

  const detailNameSelectors = ['.DUwDvf', 'h1.fontHeadlineLarge', '[data-attrid*="title"] span', 'h1'];
  for (const sel of detailNameSelectors) {
    try {
      const el = panelRoot.locator(sel).first();
      if (await el.count() > 0) {
        const detailName = (await el.textContent())?.trim() ?? '';
        if (detailName.length > 0 && detailName !== 'Results') {
          const nameA = clinic.name.toLowerCase();
          const nameB = detailName.toLowerCase();
          if (!nameA.includes(nameB.slice(0, 10)) && !nameB.includes(nameA.slice(0, 10))) {
            clinic.errors.push(`verification_mismatch: listed="${clinic.name}" detail="${detailName}"`);
            warn(`  [detail] Name mismatch: "${clinic.name}" vs "${detailName}"`);
          } else {
            log(`  [detail] Name verified: "${detailName}"`);
          }
          break;
        }
      }
    } catch { /* try next */ }
  }

  // Phone
  const phoneSelectors = [
    'a[href^="tel:"]',
    '[data-tooltip="Copy phone number"]',
    'button[aria-label*="Phone"]',
    '[data-item-id*="phone"] .fontBodyMedium',
    'span[aria-label*="phone" i]',
  ];
  for (const sel of phoneSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        // For tel: links, parse the href
        if (sel === 'a[href^="tel:"]') {
          const href = await el.getAttribute('href') ?? '';
          const phone = href.replace('tel:', '').trim();
          if (phone.length > 0) { clinic.phone = phone; break; }
        }
        // For aria-label buttons, get the label
        const ariaLabel = await el.getAttribute('aria-label') ?? '';
        const text = (await el.textContent())?.trim() ?? '';
        const raw = ariaLabel || text;
        const phoneMatch = raw.match(/[\+\d][\d\s\-\(\)\.]{6,}/);
        if (phoneMatch) { clinic.phone = phoneMatch[0].trim(); break; }
      }
    } catch { /* try next */ }
  }
  if (!clinic.phone) clinic.errors.push('missing: phone');

  // Website
  const websiteSelectors = [
    'a[data-tooltip="Open website"]',
    'a[data-item-id="authority"]',
    'a[href][aria-label*="website" i]',
    'a[href][aria-label*="Visit" i]',
    '[data-item-id*="website"] a',
  ];
  for (const sel of websiteSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        const href = await el.getAttribute('href') ?? '';
        if (href.startsWith('http')) { clinic.website = href; break; }
        // Sometimes the text IS the website
        const text = (await el.textContent())?.trim() ?? '';
        if (text.startsWith('http') || text.includes('.com') || text.includes('.net')) {
          clinic.website = text;
          break;
        }
      }
    } catch { /* try next */ }
  }
  if (!clinic.website) clinic.errors.push('missing: website');

  // Authoritative address from detail panel (overwrite the partial one)
  const detailAddressSelectors = [
    '[data-item-id*="address"] .fontBodyMedium',
    'button[aria-label*="Address"] + div',
    '[data-tooltip="Copy address"]',
    'button[data-item-id*="address"]',
  ];
  for (const sel of detailAddressSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        let addr = '';
        if (sel === '[data-tooltip="Copy address"]') {
          addr = (await el.getAttribute('aria-label'))?.replace('Copy address', '').trim() ?? '';
        } else {
          addr = (await el.textContent())?.trim() ?? '';
        }
        if (addr.length > 4) { clinic.address = addr; break; }
      }
    } catch { /* try next */ }
  }

  log(`  [detail] phone: ${clinic.phone ?? 'n/a'} | website: ${clinic.website ? 'found' : 'n/a'}`);

  // Screenshot of detail panel
  await capture(page, `05-detail-${index}-${safeName(clinic.name)}`);

  // Navigate back to list
  const backSelectors = ['button[aria-label="Back"]', 'button[aria-label="返回"]', '[jsaction*="back"]'];
  let wentBack = false;
  for (const sel of backSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        wentBack = true;
        break;
      }
    } catch { /* try next */ }
  }
  if (!wentBack) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  // Wait for list to re-appear
  try {
    await page.waitForSelector('.Nv2PK, .bfdHYd', { timeout: 8000 });
    await page.waitForTimeout(600);
  } catch {
    warn('  [detail] List did not re-appear after navigating back.');
  }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function printTerminalTable(clinics: DentalClinic[]): void {
  log('\n' + '='.repeat(72));
  log(`  DENTAL CLINICS FOUND: ${clinics.length}`);
  log('='.repeat(72));

  const tableData = clinics.map((c, i) => ({
    '#':      i + 1,
    'Name':   c.name.length > 35 ? c.name.slice(0, 33) + '..' : c.name,
    'Rating': c.rating !== null ? `${c.rating}★` : 'n/a',
    'Reviews': c.reviewCount !== null ? c.reviewCount : 'n/a',
    'Phone':   c.phone ?? 'n/a',
    'Address': c.address ? (c.address.length > 38 ? c.address.slice(0, 36) + '..' : c.address) : 'n/a',
    'Website': c.website ? '✓' : '✗',
    'Errors':  c.errors.filter(e => !e.startsWith('missing')).length || '',
  }));

  console.table(tableData);
  log(`\n  Results JSON: ${RESULTS_JSON}`);
  log(`  Screenshots:  ${SCREENSHOTS_DIR}`);
}

function printErrorSummary(clinics: DentalClinic[], globalBugs: string[]): void {
  log('\n' + '-'.repeat(72));
  log('  ERROR SUMMARY');
  log('-'.repeat(72));

  const withErrors = clinics.filter(c => c.errors.length > 0);
  if (withErrors.length === 0) {
    log('  All clinics: no errors.');
  } else {
    withErrors.forEach(c => {
      log(`  ${c.name}:`);
      c.errors.forEach(e => log(`    · ${e}`));
    });
  }

  if (globalBugs.length > 0) {
    log('\n  Global script errors:');
    globalBugs.forEach((b, i) => log(`  ${i + 1}. ${b}`));
  }
  log('-'.repeat(72));
}

// ─── Merge deduplication ──────────────────────────────────────────────────────

function mergeClinics(a: DentalClinic[], b: DentalClinic[]): DentalClinic[] {
  const result = [...a];
  const existingNames = new Set(a.map(c => c.name.toLowerCase()));
  for (const clinic of b) {
    if (!existingNames.has(clinic.name.toLowerCase())) {
      result.push(clinic);
      existingNames.add(clinic.name.toLowerCase());
    }
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Setup
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const globalBugs: string[] = [];
  let clinics: DentalClinic[] = [];

  log('');
  log('╔══════════════════════════════════════════════╗');
  log('║   Dental Clinic Scraper — Google Search      ║');
  log('╚══════════════════════════════════════════════╝');
  log(`  Query: "${SEARCH_QUERY}"`);
  log(`  Screenshots → ${SCREENSHOTS_DIR}\n`);

  // ── Browser launch strategy ──────────────────────────────────────────────
  // 1. Try attaching to already-running Chrome via CDP (port 9222)
  // 2. If that fails, launch real installed Chrome with channel:'chrome' + user profile
  // 3. If that fails, fall back to Playwright's bundled Chromium + our .chrome-profile

  let context: BrowserContext;

  // Attempt 1 — CDP attach to already-running Chrome
  let cdpConnected = false;
  try {
    log('  [browser] Trying CDP connection to running Chrome on port 9222...');
    const cdpBrowser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 3000 });
    const contexts = cdpBrowser.contexts();
    context = contexts[0] ?? await cdpBrowser.newContext();
    cdpConnected = true;
    log('  [browser] Connected to existing Chrome via CDP!');
  } catch {
    log('  [browser] CDP not available (Chrome not running with --remote-debugging-port=9222).');

    // Attempt 2 — real installed Chrome with user profile
    const userChromeProfile = path.join(
      process.env['LOCALAPPDATA'] ?? 'C:\\Users\\' + (process.env['USERNAME'] ?? 'User') + '\\AppData\\Local',
      'Google', 'Chrome', 'User Data'
    );
    const profileExists = fs.existsSync(userChromeProfile);

    if (profileExists) {
      try {
        log(`  [browser] Launching real Chrome with user profile: ${userChromeProfile}`);
        context = await chromium.launchPersistentContext(userChromeProfile, {
          channel: 'chrome',
          headless: false,
          slowMo: 250,
          args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
          viewport: { width: 1280, height: 900 },
          ignoreDefaultArgs: ['--enable-automation'],
        });
        log('  [browser] Real Chrome launched with user profile (cookies intact).');
      } catch (err) {
        warn(`  [browser] Real Chrome profile launch failed (profile may be locked): ${(err as Error).message}`);
        warn('  [browser] Falling back to Playwright Chromium + .chrome-profile...');
        context = await chromium.launchPersistentContext(PROFILE_DIR, {
          headless: false,
          slowMo: 250,
          args: ['--start-maximized'],
          viewport: { width: 1280, height: 900 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });
      }
    } else {
      log('  [browser] Chrome user profile not found. Using Playwright Chromium + .chrome-profile...');
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        slowMo: 250,
        args: ['--start-maximized'],
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
    }
  }

  // If CDP-connected, reuse an existing page if available; otherwise open a new one
  const existingPages = context.pages();
  let page = existingPages.length > 0 && cdpConnected ? existingPages[0] : await context.newPage();

  // Passive error listeners (same pattern as test-form.ts)
  page.on('console', msg => {
    if (msg.type() === 'error') globalBugs.push(`JS console error: ${msg.text()}`);
  });
  page.on('pageerror', err => globalBugs.push(`Page error: ${err.message}`));

  try {
    // ── Phase 1: Google Search (attempt, with CAPTCHA fallback) ─────────────
    log('Phase 1 — Google Search');
    log('  Navigating to google.com...');
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await dismissConsentDialogs(page);

    // Type and submit search
    const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
    await searchBox.waitFor({ timeout: 10000 });
    await searchBox.fill(SEARCH_QUERY);
    await searchBox.press('Enter');

    log('  Waiting for search results...');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await page.waitForTimeout(2000); // let JS render
    const captchaHit = await checkForCaptcha(page);
    await dismissConsentDialogs(page);

    if (!captchaHit) {
      await capture(page, '01-google-results');
      log('  Extracting local pack (3-card panel)...');
      const localPackClinics = await extractLocalPackClinics(page);
      clinics = localPackClinics;
      log(`  Local pack: ${clinics.length} clinics extracted`);
      await capture(page, '02-local-pack-extracted');
    } else {
      log('  Skipping local pack extraction (CAPTCHA was not solved).');
    }

    // ── Phase 2: Navigate to Google Maps ───────────────────────────────────
    log('\nPhase 2 — Navigate to Google Maps');

    // If still blocked / no local pack found, navigate directly to Maps
    const onMapsAlready = /maps\.google|google\.com\/maps/.test(page.url());
    let mapsPage = page;

    if (!onMapsAlready) {
      // First try clicking "More places" from search results
      const fromSearch = await clickMorePlaces(page, context);
      if (fromSearch !== page) {
        mapsPage = fromSearch;
        mapsPage.on('console', msg => {
          if (msg.type() === 'error') globalBugs.push(`JS console error: ${msg.text()}`);
        });
      } else {
        mapsPage = fromSearch;
      }
    }

    // If still not on Maps (CAPTCHA blocked search OR "More places" not found), go direct
    if (!/maps\.google|google\.com\/maps/.test(mapsPage.url())) {
      const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(SEARCH_QUERY)}`;
      log(`  Navigating directly to Maps: ${mapsUrl}`);
      await mapsPage.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000);
    }

    page = mapsPage;

    const onMaps = /maps/.test(page.url());
    if (!onMaps) {
      warn('  Skipping Maps extraction (navigation did not reach Google Maps).');
    } else {
      await dismissConsentDialogs(page);
      await page.waitForTimeout(2000);

      // ── Phase 3: Extract Maps List ─────────────────────────────────────
      log('\nPhase 3 — Google Maps List Extraction');
      await capture(page, '03-maps-list');

      log('  Extracting business cards from Maps list...');
      const mapsListClinics = await extractMapsListClinics(page);

      await scrollMapsList(page);
      await page.waitForTimeout(1000);

      // Re-extract after scroll to get new cards
      const mapsListClinics2 = await extractMapsListClinics(page);
      const allMaps = mergeClinics(mapsListClinics, mapsListClinics2);
      clinics = mergeClinics(clinics, allMaps);

      await capture(page, '04-maps-list-scrolled');
      log(`  Maps list: ${allMaps.length} unique clinics. Total so far: ${clinics.length}`);

      // ── Phase 4: Click Into Detail Panels until TARGET_PHONES phones found ──
      const phonesNeeded = TARGET_PHONES;
      let phoneCount = 0;
      let clickAttempts = 0;
      log(`\nPhase 4 — Detail Panel Extraction (target: ${phonesNeeded} phone numbers)`);

      for (let i = 0; i < clinics.length && phoneCount < phonesNeeded && clickAttempts < MAX_CLICK_ATTEMPTS; i++) {
        if (clinics[i].phone) { phoneCount++; continue; } // already has phone from earlier
        clickAttempts++;
        try {
          await extractDetailPanel(page, clinics[i], i);
          if (clinics[i].phone) {
            phoneCount++;
            log(`  [progress] Phones collected: ${phoneCount}/${phonesNeeded}`);
          }
        } catch (err) {
          const msg = `Detail extraction failed for "${clinics[i].name}": ${(err as Error).message}`;
          warn(`  [detail] ${msg}`);
          clinics[i].errors.push(msg);
          globalBugs.push(msg);
        }
      }
      log(`\n  Phase 4 complete: ${phoneCount} phones found after ${clickAttempts} clinic detail clicks.`);
    }

    // ── Output ──────────────────────────────────────────────────────────────
    log('\nPhase 5 — Output');

    fs.writeFileSync(RESULTS_JSON, JSON.stringify(clinics, null, 2), 'utf-8');
    log(`  JSON written: ${RESULTS_JSON}`);

    await capture(page, '06-final-results');

    printTerminalTable(clinics);
    printErrorSummary(clinics, globalBugs);

    log('\n  Done. Browser stays open for 10 seconds for observation...');
    await page.waitForTimeout(10_000);

  } catch (err) {
    const msg = `Fatal error: ${(err as Error).message}`;
    warn(`\n  [FATAL] ${msg}`);
    globalBugs.push(msg);
    // Capture final state even on error
    try { await capture(page, '99-error-state'); } catch { /* ignore */ }
    // Still write whatever we collected
    if (clinics.length > 0) {
      fs.writeFileSync(RESULTS_JSON, JSON.stringify(clinics, null, 2), 'utf-8');
    }
    printErrorSummary(clinics, globalBugs);
    throw err;
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error('\nScript failed:', err.message);
  process.exit(1);
});
