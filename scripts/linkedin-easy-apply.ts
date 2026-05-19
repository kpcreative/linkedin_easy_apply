import { chromium, Page, BrowserContext, Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

// ─── USER CONFIG — edit this before running ──────────────────────────────────
//
//  HOW TO USE (recommended — CDP method):
//    1. Close all Chrome windows.
//    2. Open a terminal and run:
//         "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
//       (adjust the path if Chrome is installed elsewhere)
//    3. In your browser, ensure you are logged in to LinkedIn.
//    4. Run this script:  npm run script:linkedin
//
//  If Chrome is not available or the above fails, the script will open its own
//  headed browser window. Log in manually, then press Enter in this terminal.

const CONFIG = {
  // Job search parameters
  keywords:        'fresher software developer',
  location:        'Bengaluru',
  maxApplications: 5,            // stop after this many successful submissions
  resumePath:      'C:/Users/I769395/Desktop/browser_automation_project/Kartik_Kumar_Pandey_Resume.pdf' as string | null,

  // Canned answers for common Easy Apply questions.
  // The script will warn you if it encounters a question not covered here —
  // just add a new entry to resolveAnswer() and re-run.
  answers: {
    firstName:           'Kartik',
    lastName:            'Pandey',
    fullName:            'Kartik Kumar Pandey',
    email:               'kamalnayankumar008@gmail.com',
    yearsOfExperience:   '0',
    authorizedToWork:    'Yes',
    requireSponsorship:  'No',
    genderIdentity:      'Male',
    veteranStatus:       'I am not a protected veteran',
    disabilityStatus:    'I do not wish to answer',
    desiredSalary:       '800000',
    currentCTC:          '100000',             // student/intern — entering 0 LPA
    expectedCTC:         '1200000',       // 12 LPA expected
    phoneCountryCode:    'India (+91)',   // must match the dropdown option text exactly
    phoneNumber:         '7903265535',    // local digits only — country code is separate
    city:                'Bengaluru',
    noticePeriod:        '0',             // can join immediately (student)
    linkedinUrl:         'https://www.linkedin.com/in/kartikpandey-jiit',
    githubUrl:           'https://github.com/kpcreative',
  },

  // Delays in milliseconds — keep these human-range to avoid detection
  delays: {
    betweenApplications: { min: 8_000,  max: 14_000 },
    betweenSteps:        { min: 1_200,  max: 3_500  },
    afterClick:          { min: 400,    max: 900    },
    typing:              { min: 60,     max: 140    },
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobCard {
  id:      string;
  title:   string;
  company: string;
  url:     string;
}

type ApplicationStatus = 'submitted' | 'skipped' | 'error' | 'already_applied';

interface ApplicationRecord {
  id:            string;
  title:         string;
  company:       string;
  url:           string;
  appliedAt:     string | null;
  status:        ApplicationStatus;
  errorDetail:   string | null;
  missingFields: string[];   // question labels for which no canned answer existed
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'linkedin-applications.json');
const RETRY_FILE  = path.join(DATA_DIR, 'linkedin-retry-queue.json');
const PROFILE_DIR = path.join(__dirname, '..', '.chrome-profile');

// ─── Logging helpers ─────────────────────────────────────────────────────────

function log(msg: string):  void { console.log(msg); }
function warn(msg: string): void { console.warn(msg); }

// ─── Delay / human-input helpers ─────────────────────────────────────────────

async function randomDelay(page: Page, range: { min: number; max: number }): Promise<void> {
  const ms = range.min + Math.floor(Math.random() * (range.max - range.min));
  await page.waitForTimeout(ms);
}

async function humanType(input: Locator, text: string, page: Page): Promise<void> {
  await input.click();
  // Select-all + Delete to clear any pre-existing value before typing
  await input.press('ControlOrMeta+a');
  await input.press('Delete');
  await page.waitForTimeout(80);
  for (const char of text) {
    await input.pressSequentially(char);
    const delay = CONFIG.delays.typing.min +
      Math.floor(Math.random() * (CONFIG.delays.typing.max - CONFIG.delays.typing.min));
    await page.waitForTimeout(delay);
  }
}

// For location/city fields LinkedIn shows an autocomplete dropdown — we must wait for it
// and click the first matching suggestion instead of pressing Tab.
async function humanTypeWithAutocomplete(input: Locator, text: string, page: Page): Promise<void> {
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.press('Delete');
  await page.waitForTimeout(80);

  // Type the value char by char
  for (const char of text) {
    await input.pressSequentially(char);
    const delay = CONFIG.delays.typing.min +
      Math.floor(Math.random() * (CONFIG.delays.typing.max - CONFIG.delays.typing.min));
    await page.waitForTimeout(delay);
  }

  // Wait for autocomplete dropdown to appear (LinkedIn renders suggestions asynchronously)
  await page.waitForTimeout(600);

  const autocomplete = page.locator([
    '[role="listbox"] [role="option"]',
    '[role="listbox"] li',
    '.basic-typeahead__selectable',
    '.fb-single-line-typeahead__option',
    '.typeahead-result-item',
    '[data-test-results-list-item]',
    '.search-typeahead-v2__hit',
    '.jobs-easy-apply-form-element__text-option',
  ].join(', '));

  // Click the first suggestion that contains our text (first 4 chars for resilience)
  const prefix = text.slice(0, 4);
  const suggestion = autocomplete.filter({ hasText: new RegExp(prefix, 'i') }).first();
  const appeared = await suggestion.waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true).catch(() => false);

  if (appeared) {
    await suggestion.click();
    log(`  [form] Autocomplete: selected suggestion for "${text}"`);
    await page.waitForTimeout(400);
    // Wait for the dropdown to collapse after selection
    await page.locator('[role="listbox"], .search-typeahead-v2__hit, [data-test-single-typeahead-entity-form-search-result]')
      .first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    // If still visible, click the modal header area to force dismiss
    const stillOpen = await page.locator('[data-test-single-typeahead-entity-form-search-result]')
      .isVisible({ timeout: 300 }).catch(() => false);
    if (stillOpen) {
      log(`  [form] Autocomplete dropdown still open — clicking modal header to dismiss`);
      await page.locator('.jobs-easy-apply-modal h3, .t-24, [data-test-modal] h3').first()
        .click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }
  } else {
    // No dropdown on first attempt — press ArrowDown to force first suggestion, then wait
    log(`  [form] Autocomplete: no dropdown appeared for "${text}" — trying ArrowDown`);
    await input.press('ArrowDown').catch(() => {});
    await page.waitForTimeout(800);

    const arrowAppeard = await suggestion.waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true).catch(() => false);
    if (arrowAppeard) {
      await suggestion.click();
      log(`  [form] Autocomplete: selected suggestion via ArrowDown for "${text}"`);
      await page.waitForTimeout(400);
    } else {
      // Clear and retype a shorter prefix, then wait longer
      log(`  [form] Autocomplete: retrying with shorter prefix`);
      await input.press('ControlOrMeta+a');
      await input.press('Delete');
      await page.waitForTimeout(200);
      const shortPrefix = text.slice(0, 5);
      for (const char of shortPrefix) {
        await input.pressSequentially(char);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(1200);

      const retryAppeard = await suggestion.waitFor({ state: 'visible', timeout: 2_000 })
        .then(() => true).catch(() => false);
      if (retryAppeard) {
        await suggestion.click();
        log(`  [form] Autocomplete: selected suggestion on retry for "${text}"`);
        await page.waitForTimeout(400);
      } else {
        // Last resort: commit with Enter then Tab
        log(`  [form] Autocomplete: still no dropdown — committing with Enter+Tab`);
        await input.press('Enter').catch(() => {});
        await page.waitForTimeout(300);
        await input.press('Tab').catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }
}

async function humanClick(locator: Locator, page: Page): Promise<void> {
  try {
    const box = await locator.boundingBox();
    if (box) {
      const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      await page.mouse.move(x, y, { steps: 12 });
      await page.waitForTimeout(80 + Math.floor(Math.random() * 120));
    }
  } catch { /* bounding box unavailable, fall through to click */ }
  await locator.click();
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadApplications(): ApplicationRecord[] {
  if (!fs.existsSync(OUTPUT_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')) as ApplicationRecord[];
  } catch {
    return [];
  }
}

function appendApplication(record: ApplicationRecord): void {
  const existing = loadApplications();
  existing.push(record);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2), 'utf-8');
}

function isAlreadyApplied(jobId: string, records: ApplicationRecord[]): boolean {
  return records.some(r => r.id === jobId && r.status === 'submitted');
}

// ─── Retry queue helpers ───────────────────────────────────────────────────────
// Jobs that failed validation/error are saved here so the next run navigates
// directly to their URL instead of relying on the search results list.

function loadRetryQueue(): JobCard[] {
  if (!fs.existsSync(RETRY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RETRY_FILE, 'utf-8')) as JobCard[];
  } catch {
    return [];
  }
}

function addToRetryQueue(job: JobCard): void {
  const queue = loadRetryQueue();
  if (!queue.some(j => j.id === job.id)) {
    queue.push(job);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RETRY_FILE, JSON.stringify(queue, null, 2), 'utf-8');
    log(`  [retry] Queued for retry next run: "${job.title}" @ ${job.company} → ${job.url}`);
  }
}

function removeFromRetryQueue(jobId: string): void {
  const queue = loadRetryQueue().filter(j => j.id !== jobId);
  fs.writeFileSync(RETRY_FILE, JSON.stringify(queue, null, 2), 'utf-8');
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function waitForEnterKey(): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });
}

async function dismissLinkedInModals(page: Page): Promise<void> {
  const dismissSelectors = [
    'button[aria-label="Dismiss"]',
    'button:has-text("Got it")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Not now")',
    'button:has-text("Skip")',
  ];
  for (const sel of dismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(500);
        log(`  [modal] Dismissed: ${sel}`);
      }
    } catch { /* not present */ }
  }
}

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await dismissLinkedInModals(page);

  // Primary check: URL — if LinkedIn didn't redirect us to /login or /checkpoint, we're in
  const currentUrl = page.url();
  const urlLoggedIn = /linkedin\.com\/(feed|jobs|in\/|mynetwork|messaging)/i.test(currentUrl)
    && !/\/login|\/signup|\/checkpoint|authwall/i.test(currentUrl);

  // Secondary check: any nav element that only appears when authenticated
  const domLoggedIn = urlLoggedIn || await page
    .locator([
      '.global-nav__me',
      '.global-nav__me-photo',
      'nav.global-nav',
      '[data-control-name="identity_welcome_message"]',
      '.feed-identity-module',
      '#global-nav',
      'header.global-nav',
    ].join(', '))
    .isVisible({ timeout: 4_000 })
    .catch(() => false);

  if (domLoggedIn) {
    log(`  [auth] Already logged in to LinkedIn. (url: ${currentUrl.slice(0, 60)})`);
    return;
  }

  log('');
  log('  ┌─────────────────────────────────────────────────────────────┐');
  log('  │  NOT logged in to LinkedIn.                                  │');
  log('  │  Please log in manually in the browser window that opened.  │');
  log('  │  After you are fully logged in, return here and press ENTER. │');
  log('  └─────────────────────────────────────────────────────────────┘');
  log('');
  await waitForEnterKey();
  await page.waitForTimeout(1_500);
  log('  [auth] Continuing...');
}

// ─── Browser launch ───────────────────────────────────────────────────────────
//
// Tier 1: CDP attach to already-running Chrome (best — real session, real fingerprint)
// Tier 2: Playwright Chromium + .chrome-profile/ (fallback — user logs in once, session saved)

async function launchBrowser(): Promise<{ context: BrowserContext; cdpConnected: boolean }> {
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Tier 1 — CDP attach
  log('  [browser] Trying CDP connection to running Chrome on port 9222...');
  try {
    const cdpBrowser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 3_000 });
    const contexts = cdpBrowser.contexts();
    const context = contexts[0] ?? await cdpBrowser.newContext();
    log('  [browser] Connected to existing Chrome via CDP — using your live session!');
    return { context, cdpConnected: true };
  } catch {
    log('  [browser] CDP not available. Launching Playwright Chromium with persistent profile...');
    log('  [browser] TIP: For best results, run Chrome with --remote-debugging-port=9222 first.');
    log('  [browser]      See instructions at the top of this script.');
  }

  // Tier 2 — persistent context with project profile
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo:   80,
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  log('  [browser] Playwright Chromium launched with persistent profile.');
  return { context, cdpConnected: false };
}

// ─── Job list collection ──────────────────────────────────────────────────────

function buildSearchUrl(): string {
  const params = new URLSearchParams({
    keywords: CONFIG.keywords,
    location:  CONFIG.location,
    f_AL:      'true',    // Easy Apply filter
    sortBy:    'DD',      // Date descending — freshest jobs first
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function collectJobCards(page: Page): Promise<JobCard[]> {
  const jobs: JobCard[] = [];
  const buffer = Math.max(CONFIG.maxApplications * 5, 15);  // collect enough candidates (some will be skipped/external)
  let pageNum = 0;

  log(`  [jobs] Collecting up to ${buffer} Easy Apply job listings...`);

  while (jobs.length < buffer) {
    // Wait for job list to render — LinkedIn uses data-occludable-job-id on most views,
    // but some layouts use data-job-id instead.
    await page.waitForSelector('li[data-occludable-job-id], li[data-job-id], .job-card-container', { timeout: 15_000 });
    await page.waitForTimeout(1_000);

    const cards = await page.locator('li[data-occludable-job-id], li[data-job-id]').all();
    log(`  [jobs] Page ${pageNum + 1}: found ${cards.length} cards`);

    for (const card of cards) {
      // Extract job ID from whichever attribute is present
      const jobId = (await card.getAttribute('data-occludable-job-id').catch(() => null))
                 ?? (await card.getAttribute('data-job-id').catch(() => null));
      if (!jobId || jobs.some(j => j.id === jobId)) continue;

      // Scroll into view before reading attributes (list is virtualized)
      await card.scrollIntoViewIfNeeded().catch(() => {});

      // f_AL=true in the search URL guarantees every listed job is Easy Apply.
      // Do NOT filter by badge text — the badge is often hidden by list virtualization.
      // We log whether the badge was visible purely for diagnostic purposes.
      const isEasyApply = await card
        .locator('.job-card-container__footer-item, .job-card-container__apply-method')
        .filter({ hasText: /easy apply/i })
        .isVisible({ timeout: 800 })
        .catch(() => false);
      if (!isEasyApply) {
        log(`  [jobs] Note: Easy Apply badge not visible on card ${jobId} (virtualization) — including anyway`);
      }

      const titleEl = card.locator(
        'a.job-card-list__title--link, a.job-card-list__title, a[data-control-name="jobcard_title"]'
      ).first();
      // Use the aria-hidden span which contains only the clean title text (avoids "Title with verification" duplication)
      const titleRaw = await titleEl.locator('span[aria-hidden="true"]').textContent().catch(async () =>
        (await titleEl.textContent().catch(() => ''))
      );
      const title = (typeof titleRaw === 'string' ? titleRaw : (titleRaw ?? ''))
        .replace(/\s*with\s+verification\s*/gi, '')
        .replace(/\n+/g, ' ')
        .trim() || 'Unknown Title';
      const company = ((await card.locator(
        '.job-card-container__primary-description, .job-card-container__company-name, .artdeco-entity-lockup__subtitle'
      ).first().textContent().catch(() => ''))?.trim() ?? '') || 'Unknown Company';
      const href = await titleEl.getAttribute('href').catch(() => null);

      jobs.push({
        id:      jobId,
        title,
        company,
        url:     href ? `https://www.linkedin.com${href.split('?')[0]}` : '',
      });

      if (jobs.length >= buffer) break;
    }

    if (jobs.length >= buffer) break;

    // Try to advance to next page
    const nextBtn = page.locator('button[aria-label="View next page"]').first();
    const hasNext = await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasNext) break;

    await nextBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await randomDelay(page, CONFIG.delays.betweenSteps);
    pageNum++;
  }

  log(`  [jobs] Collected ${jobs.length} Easy Apply jobs across ${pageNum + 1} page(s).`);
  return jobs;
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function resolveAnswer(label: string): string | null {
  const l = label.toLowerCase();

  // Name fields — check before generic "first" match
  if (/first\s*name/i.test(l))                             return CONFIG.answers.firstName;
  if (/last\s*name|surname|family\s*name/i.test(l))        return CONFIG.answers.lastName;
  if (/\bfull\s*name\b|\bname\b/i.test(l))                 return CONFIG.answers.fullName;
  if (/\bemail\b|e-mail/i.test(l))                         return CONFIG.answers.email;

  // Country code must be checked BEFORE the generic phone check
  if (/country\s*code/i.test(l))                            return CONFIG.answers.phoneCountryCode;
  if (/additional\s*months|months.*experience|months.*additional/i.test(l)) return '0';  // 0 additional months
  if (/years?.*(of\s+)?experience/i.test(l))              return CONFIG.answers.yearsOfExperience;
  if (/authorized|legally\s+authorized|eligible.*(work|employment)/i.test(l)) return CONFIG.answers.authorizedToWork;
  if (/require.*sponsor|need.*visa|visa.*sponsor/i.test(l)) return CONFIG.answers.requireSponsorship;
  if (/gender|sex\b/i.test(l))                             return CONFIG.answers.genderIdentity;
  if (/veteran|military\s+status/i.test(l))                return CONFIG.answers.veteranStatus;
  if (/disability|disabled/i.test(l))                      return CONFIG.answers.disabilityStatus;
  if (/salary|compensation|expected.*pay|desired.*pay/i.test(l)) return CONFIG.answers.desiredSalary;
  if (/current.*ctc|current.*salary|current.*compensation/i.test(l)) return CONFIG.answers.currentCTC;
  if (/expected.*ctc|expected.*salary|expected.*compensation/i.test(l)) return CONFIG.answers.expectedCTC;
  if (/phone|mobile|telephone/i.test(l))                   return CONFIG.answers.phoneNumber;
  if (/\bcity\b|location.*city|\bcurrent.*location\b|\blocation\b/i.test(l))  return CONFIG.answers.city;
  if (/notice\s*(period|months|weeks|days)|start\s*date\s*notice|how\s*soon.*join|earliest.*join|joining.*timeline/i.test(l)) return CONFIG.answers.noticePeriod;
  // "Is your LinkedIn profile up to date" — Yes/No select, NOT a URL field (check before linkedin.*url)
  if (/linkedin.*up\s+to\s+date|up\s+to\s+date.*linkedin/i.test(l)) return 'Yes';
  if (/linkedin.*url|linkedin.*profile|linkedin\.com/i.test(l)) return CONFIG.answers.linkedinUrl;
  if (/github.*url|github\.com|portfolio.*url|website.*url/i.test(l)) return CONFIG.answers.githubUrl;

  // Yes/No fallbacks for common screener questions about location, availability, willingness
  if (/\bjoin.*immediately\b|available.*immediately|immediate.*joiner|immediate.*join/i.test(l)) return 'Yes';
  if (/\bbanglore\b|\bbangalore\b|\bbengaluru\b.*location|location.*\bbengaluru\b|current.*location.*bang/i.test(l)) return 'Yes';
  if (/relocat/i.test(l))                                   return 'Yes';
  if (/work.*onsite|onsite.*work|in.?office/i.test(l))     return 'Yes';
  // Generic "do you have experience in X" screener → default Yes
  if (/\bdo you have experience\b/i.test(l))               return 'Yes';
  // "this position is X, will you be able to..." screener → default Yes
  if (/\bwill you be able to\b/i.test(l))                  return 'Yes';
  // Education level screener
  if (/bachelor|b\.?tech|undergraduate|degree/i.test(l))   return 'Yes';
  // Generic "have you X" / "are you X" screener for skills/tools
  if (/\bhave you (completed|done|built|shipped|integrated|used)\b/i.test(l)) return 'Yes';
  if (/\bare you open to\b|\bare you willing\b|\bare you comfortable\b/i.test(l)) return 'Yes';
  // "Are you prepared to X" / "Are you committed to X" screener
  if (/\bare you prepared to\b|\bare you committed to\b/i.test(l)) return 'Yes';

  // Privacy policy / "By clicking Yes you agree" radio (Turing-style)
  if (/privacy\s*policy|by\s+clicking\s+['""]?yes['""]?|agree\s+to\s+our|data\s+processing\s+consent/i.test(l)) return 'Yes';

  // Hybrid / work schedule willingness
  if (/hybrid|work\s+schedule|willing\s+to\s+work\s+(hybrid|in\s*office|onsite)/i.test(l)) return 'Yes';

  // Days-to-join numeric (different wording from notice period)
  if (/how\s+much\s+time.*join|time.*you\s+need.*join|no\.\s*of\s*days.*join|join.*in\s*days/i.test(l)) return CONFIG.answers.noticePeriod;

  // "Are you available in Bengaluru / Bangalore for interview"
  if (/available\s+in\s+(bengaluru|bangalore)/i.test(l)) return 'Yes';

  // "What is your overall hands-on industry work experience"
  if (/overall.*hands.?on.*experience|industry.*work\s*experience|hands.?on.*industry/i.test(l)) return CONFIG.answers.yearsOfExperience;

  // High school / diploma education question
  if (/high\s*school|diploma|secondary\s+school/i.test(l)) return 'Yes';

  // Neurodiversity self-identification
  if (/neuro\s*divers/i.test(l)) return 'Prefer not to say';

  // "What is your level of proficiency in English?" → Fluent / Professional
  if (/proficiency.*english|english.*proficiency|english.*level|level.*english/i.test(l)) return 'Professional working proficiency';

  // "Have you directly integrated AI platforms / LLM APIs into production?" → Yes
  if (/integrated.*ai\s*platform|llm\s*api|ai\s*framework.*production|production.*backend.*ai/i.test(l)) return 'Yes';

  // "Have you designed.*RAG pipeline / Vector Database?" → Yes (candidate has Python/Node)
  if (/rag\s*pipeline|vector\s*database|retrieval.?augmented|embedding\s*strateg/i.test(l)) return 'Yes';

  // "Have you designed.*NoSQL.*Relational.*databases?" → Yes
  if (/nosql.*relational|mongodb.*postgresql|postgresql.*mongodb|both.*databases/i.test(l)) return 'Yes';

  // "Can you invest X hours per day for this internship?" → Yes
  if (/invest.*hours.*per\s*day|hours\s*per\s*day.*internship|time\s*commitment|minimum.*hours/i.test(l)) return 'Yes';

  // GDPR / consent to collect/store/process data (Ivanti-style)
  if (/consent\s+to\s+collect|consent\s+to\s+store|consent.*process.*data/i.test(l)) return 'Yes';

  // "How much experience in [technology]?" / "Provide your experience in [X]?" → 0 (fresher)
  if (/how\s+much\s+experience\s+in|provide\s+your\s+experience\s+in|experience\s+in\s+\w/i.test(l)) return '0';

  // "Rate your comm(unication) skills out of 5?" — eTeam uses Yes/No for this
  if (/rate.*comm.*skills|comm.*skills.*rate|communication\s+skills.*out\s+of/i.test(l)) return 'Yes';

  // "Do you have hands-on code writing experience without Chatgpt / AI tools?" → Yes
  if (/hands.?on\s+code\s+writing|code\s+writing\s+experience\s+without|without.*chatgpt|without.*code\s+writing\s+software/i.test(l)) return 'Yes';

  // "Do you have experience with agentic platforms / AI platforms?" → Yes (candidate has JS/TS/Python)
  if (/agentic\s+platform|copilot\s+studio|moveworks|snaplogic|n8n/i.test(l)) return 'Yes';

  return null;
}

// LinkedIn labels often use aria-hidden + visible span which causes textContent to double the text.
// e.g. <label><span aria-hidden="true">Phone country code</span>Phone country code</label>
// dedupeLabel("Phone country codePhone country code") → "Phone country code"
function dedupeLabel(text: string): string {
  const t = text.trim();
  // Strategy 1: exact even-length double (original behaviour)
  if (t.length > 0 && t.length % 2 === 0) {
    const half = t.length / 2;
    if (t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
  }
  // Strategy 2: prefix-repeat — handles "FooFoo\n  Required" → "Foo"
  // Covers LinkedIn labels that are doubled then have " Required" appended
  if (t.length > 8) {
    for (let half = Math.floor(t.length / 2); half >= 8; half--) {
      const candidate = t.slice(0, half);
      if (t.slice(half).trimStart().startsWith(candidate)) {
        return candidate.trim();
      }
    }
  }
  return t;
}

async function getLabelFor(input: Locator, modal: Locator): Promise<string> {
  // Strategy 1: explicit <label for="id">
  const inputId = await input.getAttribute('id').catch(() => null);
  if (inputId) {
    const labelEl = modal.locator(`label[for="${inputId}"]`).first();
    if (await labelEl.count() > 0) {
      const t = (await labelEl.textContent().catch(() => ''))?.trim() ?? '';
      if (t) return dedupeLabel(t);
    }
  }

  // Strategy 2: aria-label on the input itself
  const ariaLabel = await input.getAttribute('aria-label').catch(() => null);
  if (ariaLabel?.trim()) return dedupeLabel(ariaLabel.trim());

  // Strategy 3: walk up to 5 ancestor elements looking for a label
  const nearestLabel = await input.evaluate((el): string => {
    let node = el as (typeof el & { parentElement: typeof el | null });
    for (let i = 0; i < 5; i++) {
      const parent = (node as unknown as { parentElement: typeof node | null }).parentElement;
      if (!parent) break;
      node = parent;
      const lbl = (node as unknown as { querySelector: (s: string) => { textContent?: string | null } | null }).querySelector(
        'label, .fb-dash-form-element__label, .fb-form-element__label, legend'
      );
      if (lbl) return (lbl.textContent ?? '').trim();
    }
    return '';
  }).catch(() => '');

  return dedupeLabel(nearestLabel ?? '');
}

async function handleFormStep(page: Page, modal: Locator, _job: JobCard): Promise<string[]> {
  const missing: string[] = [];

  // 1. Resume file upload
  const fileInput = modal.locator('input[type="file"]').first();
  if (await fileInput.isVisible({ timeout: 500 }).catch(() => false)) {
    if (CONFIG.resumePath && fs.existsSync(CONFIG.resumePath)) {
      await fileInput.setInputFiles(CONFIG.resumePath);
      log('  [form] Uploaded resume.');
      await randomDelay(page, CONFIG.delays.afterClick);
    } else if (CONFIG.resumePath) {
      warn(`  [form] Resume path set but file not found: ${CONFIG.resumePath}`);
    }
  }

  // 2. Text inputs — skip only if correctly pre-filled; retype if wrong value
  const textInputs = await modal.locator(
    'input[type="text"]:visible, input[type="number"]:visible, input[type="tel"]:visible, input[type="email"]:visible, input[type="url"]:visible'
  ).all();
  for (const input of textInputs) {
    const label   = await getLabelFor(input, modal);
    const answer  = resolveAnswer(label);

    if (!answer) {
      const currentVal = (await input.inputValue().catch(() => '')).trim();
      if (currentVal === '' && label) {
        warn(`  [form] No answer for text field: "${label}" — leaving blank`);
        missing.push(label);
      }
      continue;
    }

    const currentVal = (await input.inputValue().catch(() => '')).trim();

    // If the input is type="number" but our resolved answer isn't numeric
    // (e.g. city regex matched a label asking "how long have you worked in Bengaluru?"),
    // override with '0' so the field gets a valid decimal value.
    const inputType = await input.getAttribute('type').catch(() => 'text');
    const effectiveAnswer = (inputType === 'number' && isNaN(parseFloat(answer))) ? '0' : answer;

    // Skip only if already filled with the correct value
    if (currentVal !== '' && currentVal === effectiveAnswer) {
      log(`  [form] Text field "${label}" already has correct value — skipping`);
      continue;
    }

    // Field is empty or has wrong/stale value — (re)type it
    // Location/city fields show an autocomplete dropdown — use the autocomplete-aware helper
    const isLocationField = /\bcity\b|\blocation\b/i.test(label) && inputType !== 'number';
    if (isLocationField) {
      await humanTypeWithAutocomplete(input, effectiveAnswer, page);
    } else {
      await humanType(input, effectiveAnswer, page);
      // If field has a min attribute > 0 and our answer is "0", retype with the min value as fallback
      // (e.g. "current CTC in Lakhs" with min="0.1" will reject "0")
      const minAttr = await input.getAttribute('min').catch(() => null);
      const minVal  = minAttr !== null ? parseFloat(minAttr) : NaN;
      if (!isNaN(minVal) && minVal > 0 && effectiveAnswer === '0') {
        const fallback = String(minVal);
        log(`  [form] "${label}" has min=${minVal} but answer is "0" — retyping with fallback "${fallback}"`);
        await humanType(input, fallback, page);
      }
      log(`  [form] Filled "${label}" → "${effectiveAnswer}"`);
      // Press Tab to blur and dismiss any typeahead/autocomplete dropdown
      // (Escape is intentionally avoided — it triggers LinkedIn's "Discard application" dialog)
      await input.press('Tab').catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  // 3. Textareas — skip pre-filled
  const textareas = await modal.locator('textarea:visible').all();
  for (const ta of textareas) {
    const currentVal = (await ta.inputValue().catch(() => '')).trim();
    if (currentVal !== '') continue;
    const label  = await getLabelFor(ta, modal);
    const answer = resolveAnswer(label);
    if (answer) {
      await humanType(ta, answer, page);
      log(`  [form] Filled textarea "${label}" → "${answer.slice(0, 40)}"`);
    } else if (label) {
      warn(`  [form] No answer for textarea: "${label}" — leaving blank`);
      missing.push(label);
    }
  }

  // 4. Select / dropdown — skip if already has a non-placeholder selection
  const selects = await modal.locator('select:visible').all();
  for (const select of selects) {
    const label  = await getLabelFor(select, modal);
    const answer = resolveAnswer(label);
    if (!answer) {
      if (label) {
        warn(`  [form] No answer for select: "${label}" — leaving as-is`);
        missing.push(label);
      }
      continue;
    }

    // Scroll into view so the element is interactable
    await select.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);

    // Attempt 1: exact label match
    let succeeded = await select.selectOption({ label: answer })
      .then(() => true)
      .catch(() => false);

    // Attempt 2: exact value match
    if (!succeeded) {
      succeeded = await select.selectOption({ value: answer }).then(() => true).catch(() => false);
    }

    // Attempt 3: case-insensitive partial label match
    if (!succeeded) {
      const options = await select.locator('option').all();
      for (const opt of options) {
        const optText  = (await opt.textContent().catch(() => '') ?? '').trim();
        const optValue = (await opt.getAttribute('value').catch(() => '') ?? '').trim();
        if (optText.toLowerCase().includes(answer.toLowerCase()) ||
            answer.toLowerCase().includes(optText.toLowerCase())) {
          succeeded = await select.selectOption({ value: optValue }).then(() => true).catch(() => false);
          if (succeeded) {
            log(`  [form] Dropdown partial match: "${optText}" for answer "${answer}"`);
            break;
          }
        }
      }
    }

    // Attempt 4: numeric fuzzy match — when answer is a number and dropdown has range options like "3-5 years"
    if (!succeeded) {
      const num = parseFloat(answer);
      if (!isNaN(num)) {
        const options = await select.locator('option').all();
        for (const opt of options) {
          const optText  = (await opt.textContent().catch(() => '') ?? '').trim();
          const optValue = (await opt.getAttribute('value').catch(() => '') ?? '').trim();
          const rangeMatch = /(\d+)\s*[-–]\s*(\d+)/.exec(optText);
          if (rangeMatch && num >= parseFloat(rangeMatch[1]) && num <= parseFloat(rangeMatch[2])) {
            succeeded = await select.selectOption({ value: optValue }).then(() => true).catch(() => false);
            if (succeeded) {
              log(`  [form] Dropdown range match: "${optText}" for answer "${answer}"`);
              break;
            }
          } else if (optText.startsWith(answer) || optValue === answer || optText === answer) {
            succeeded = await select.selectOption({ value: optValue }).then(() => true).catch(() => false);
            if (succeeded) break;
          }
        }
      }
    }

    if (succeeded) {
      // Dispatch change event so React/Vue state updates pick it up
      await select.dispatchEvent('change');
      await page.waitForTimeout(300);
      log(`  [form] Selected "${answer}" for "${label}"`);
    } else {
      // Attempt 5: for numeric answer "0" that failed all four attempts,
      // pick the first non-placeholder option (handles "0 additional months" dropdowns)
      if (!isNaN(parseFloat(answer)) && parseFloat(answer) === 0) {
        const options = await select.locator('option').all();
        for (const opt of options) {
          const optVal = (await opt.getAttribute('value').catch(() => '') ?? '').trim();
          const optTxt = (await opt.textContent().catch(() => '') ?? '').trim();
          if (optVal !== '' && optVal !== 'default' && !/select|choose|pick/i.test(optTxt)) {
            succeeded = await select.selectOption({ value: optVal }).then(() => true).catch(() => false);
            if (succeeded) {
              await select.dispatchEvent('change');
              log(`  [form] Select fallback (first valid option) "${optTxt}" for "${label}"`);
              break;
            }
          }
        }
      }
      if (!succeeded) {
        // Log all available options to help diagnose mismatches
        const allOpts = await select.locator('option').all();
        const optSummary = (await Promise.all(allOpts.map(async o => {
          const t = (await o.textContent().catch(() => '') ?? '').trim();
          const v = (await o.getAttribute('value').catch(() => '') ?? '').trim();
          return `"${t}"(${v})`;
        }))).join(', ');
        warn(`  [form] Could not select "${answer}" for "${label}" — available: ${optSummary}`);
        missing.push(label);
      }
    }
  }

  // 4b. Artdeco / custom dropdowns — LinkedIn renders some selects as div-based
  //     components with a trigger button and a [role="listbox"] options panel.
  //     Selector: any form element wrapper that has a trigger button but no native <select>.
  const artdecoDropdowns = await modal.locator([
    '[data-test-text-entity-list-form-select]:visible',
    'div.fb-dash-form-element:visible:has(button[aria-haspopup="listbox"])',
    'div.fb-form-element:visible:has(button[aria-haspopup="listbox"])',
    'div.jobs-easy-apply-form-element:visible:has(button[aria-haspopup="listbox"])',
  ].join(', ')).all();

  for (const wrapper of artdecoDropdowns) {
    const labelEl = wrapper.locator('label, .fb-dash-form-element__label, .fb-form-element__label').first();
    const rawLabel = (await labelEl.textContent().catch(() => ''))?.trim() ?? '';
    const label = dedupeLabel(rawLabel);
    const answer = resolveAnswer(label);
    if (!answer) {
      if (label) {
        warn(`  [form] No answer for custom dropdown: "${label}" — leaving as-is`);
        missing.push(label);
      }
      continue;
    }

    // Click the trigger button to open the options panel
    const trigger = wrapper.locator('button[aria-haspopup="listbox"], button[aria-expanded]').first();
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click().catch(() => {});
    await page.waitForTimeout(400);

    // Find the matching option in the listbox
    const listbox = page.locator('[role="listbox"]:visible').first();
    const appeared = await listbox.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      warn(`  [form] Custom dropdown listbox did not appear for "${label}"`);
      missing.push(label);
      continue;
    }

    // Try exact text match first, then partial/numeric
    const options = listbox.locator('[role="option"]');
    let picked = false;
    const count = await options.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      const optText = (await opt.textContent().catch(() => ''))?.trim() ?? '';
      const numAnswer = parseFloat(answer);
      const matches = optText === answer ||
        optText.toLowerCase().includes(answer.toLowerCase()) ||
        (!isNaN(numAnswer) && optText.startsWith(String(numAnswer)));
      if (matches) {
        await opt.click().catch(() => {});
        await page.waitForTimeout(300);
        log(`  [form] Custom dropdown selected "${optText}" for "${label}"`);
        picked = true;
        break;
      }
    }
    if (!picked) {
      // Close the dropdown and warn
      await page.keyboard.press('Escape').catch(() => {});
      warn(`  [form] Custom dropdown: no matching option for answer "${answer}" on "${label}"`);
      missing.push(label);
    }
  }

  // 5. Radio groups — fieldsets
  const radioGroups = await modal.locator('fieldset:visible').all();
  for (const group of radioGroups) {
    const legendRaw = ((await group.locator('legend, span.fb-form-element__label, .fb-dash-form-element__label').first().textContent().catch(() => ''))?.trim()) ?? '';
    const legend = dedupeLabel(legendRaw);
    const answer = resolveAnswer(legend);
    if (!answer) {
      if (legend) missing.push(legend);
      continue;
    }

    // Prefer clicking the <label> — it's always on top and won't be intercepted.
    // input[value] is a fallback but a sibling <label> often intercepts clicks on the input.
    const radioOption = group.locator(`label:has-text("${answer}")`).first();
    const labelVisible = await radioOption.isVisible({ timeout: 500 }).catch(() => false);
    if (labelVisible) {
      await radioOption.click({ force: true });
      log(`  [form] Selected radio "${answer}" for "${legend}"`);
    } else {
      // Fallback: find any label whose text contains the answer (case-insensitive)
      const allLabels = await group.locator('label').all();
      let clicked = false;
      for (const lbl of allLabels) {
        const txt = (await lbl.textContent().catch(() => '') ?? '').trim();
        if (txt.toLowerCase().includes(answer.toLowerCase())) {
          await lbl.click({ force: true }).catch(() => {});
          log(`  [form] Selected radio (fallback) "${txt}" for "${legend}"`);
          clicked = true;
          break;
        }
      }
      // Last resort: click the radio input whose associated label contains the answer
      if (!clicked) {
        const allInputs = await group.locator('input[type="radio"]').all();
        for (const inp of allInputs) {
          const val = (await inp.getAttribute('value').catch(() => '') ?? '').trim();
          if (val.toLowerCase().includes(answer.toLowerCase())) {
            await inp.click({ force: true }).catch(() => {});
            log(`  [form] Selected radio input value="${val}" for "${legend}"`);
            clicked = true;
            break;
          }
        }
      }
      if (!clicked) {
        warn(`  [form] Radio option "${answer}" not found for "${legend}"`);
      }
    }
  }

  // 6. Checkboxes — auto-check attestation/agreement boxes
  const checkboxes = await modal.locator('input[type="checkbox"]:visible').all();
  for (const cb of checkboxes) {
    const isChecked = await cb.isChecked().catch(() => false);
    if (isChecked) continue;
    const label = await getLabelFor(cb, modal);
    if (/agree|certify|acknowledge|confirm|i\s+certify|consent|authorize/i.test(label)) {
      await cb.check();
      log(`  [form] Checked attestation: "${label.slice(0, 60)}"`);
    }
  }

  return missing;
}

// ─── Modal navigation ─────────────────────────────────────────────────────────

async function walkModal(page: Page, modal: Locator, job: JobCard): Promise<{ status: ApplicationStatus; missingFields: string[] }> {
  let reviewedOnce = false;
  const allMissing: string[] = [];

  for (let step = 0; step < 12; step++) {
    await randomDelay(page, CONFIG.delays.betweenSteps);

    // Check for modal navigation buttons.
    // LinkedIn occasionally updates aria-label wording — add :has-text() fallbacks for resilience.
    const hasSubmit = await modal.locator(
      'button[aria-label="Submit application"], button:has-text("Submit application")'
    ).isVisible({ timeout: 2_000 }).catch(() => false);
    const hasReview = await modal.locator(
      'button[aria-label="Review your application"], button:has-text("Review your application")'
    ).isVisible({ timeout: 1_000 }).catch(() => false);
    const hasNext = await modal.locator(
      'button[aria-label="Continue to next step"], button:has-text("Next")'
    ).isVisible({ timeout: 1_000 }).catch(() => false);

    if (hasSubmit) {
      // Handle the current step's form before submitting
      const stepMissing = await handleFormStep(page, modal, job);
      allMissing.push(...stepMissing);
      await randomDelay(page, CONFIG.delays.afterClick);

      const submitBtn = modal.locator('button[aria-label="Submit application"], button:has-text("Submit application")').first();
      await humanClick(submitBtn, page);
      log(`  [modal] Clicked "Submit application"`);

      // Wait for the confirmation screen — LinkedIn uses several different success indicators
      const confirmed = await page
        .locator([
          '.artdeco-inline-feedback--success',
          'h3:has-text("Application sent")',
          'h3:has-text("Your application was sent")',
          '[data-test-modal] h3',              // generic modal heading after submit
          '.jobs-easy-apply-content h3',
          'div[role="dialog"] h3',
        ].join(', '))
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);

      if (confirmed) {
        log(`  [apply] ✓ Application submitted: "${job.title}" at ${job.company}`);
      } else {
        warn(`  [apply] Submit clicked but confirmation not detected — marking as submitted anyway`);
      }

      // Dismiss any post-submit popup (e.g. "Share your application", recruiter note prompt, survey)
      await page.waitForTimeout(1_500);
      const postSubmitDismissed = await page.locator([
        'button[aria-label="Dismiss"]',
        'button:has-text("Done")',
        'button:has-text("Not now")',
        'button:has-text("Skip")',
        'button:has-text("Close")',
      ].join(', ')).first().click().then(() => true).catch(() => false);
      if (postSubmitDismissed) {
        log(`  [modal] Post-submit popup dismissed`);
        await page.waitForTimeout(500);
      }

      return { status: 'submitted', missingFields: allMissing };
    }

    // Fill out the current step before advancing
    const stepMissing = await handleFormStep(page, modal, job);
    allMissing.push(...stepMissing);
    await randomDelay(page, CONFIG.delays.afterClick);

    // Check for validation errors before clicking Next
    const hasError = await modal
      .locator('.fb-dash-form-element__error, [data-test-form-element-error], .artdeco-inline-feedback--error')
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (hasError) {
      const errorText = ((await modal.locator('.fb-dash-form-element__error, [data-test-form-element-error]').first().textContent().catch(() => ''))?.trim()) ?? 'validation error';
      warn(`  [modal] Validation error on step ${step}: "${errorText}" — discarding application`);
      // Discard gracefully
      await modal.locator('button[aria-label="Dismiss"]').click().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('[data-test-dialog-confirm-btn]:has-text("Discard"), button:has-text("Discard")').click().catch(() => {});
      return { status: 'error', missingFields: allMissing };  // 'error' → goes into retry queue
    }

    if (hasReview && !reviewedOnce) {
      reviewedOnce = true;
      const reviewBtn = modal.locator('button[aria-label="Review your application"], button:has-text("Review your application")').first();
      await humanClick(reviewBtn, page);
      log(`  [modal] Step ${step}: clicked "Review"`);
      // Wait for the review/summary page to load
      await page.waitForTimeout(1_500);
    } else if (hasReview && reviewedOnce) {
      // Already on the review page — Submit should appear; if Review shows again something is wrong
      warn(`  [modal] Review button appeared again at step ${step} — required fields may be unfilled. Discarding.`);
      await modal.locator('button[aria-label="Dismiss"]').click().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('[data-test-dialog-confirm-btn]:has-text("Discard"), button:has-text("Discard")').click().catch(() => {});
      return { status: 'error', missingFields: allMissing };  // 'error' → goes into retry queue
    } else if (hasNext) {
      // Guard 1: close any open autocomplete dropdown before clicking Next
      const dropdownOpen = await page
        .locator('[data-test-single-typeahead-entity-form-search-result], [role="listbox"]')
        .first().isVisible({ timeout: 500 }).catch(() => false);
      if (dropdownOpen) {
        log(`  [modal] Closing autocomplete dropdown before Next...`);
        await modal.locator('h3, .t-24, .jobs-easy-apply-modal__header').first()
          .click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
        await page.locator('[data-test-single-typeahead-entity-form-search-result]')
          .first().waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
      }
      // Guard 2: dismiss unexpected discard confirmation dialog
      const discardOpen = await page
        .locator('[data-test-modal-id="data-test-easy-apply-discard-confirmation"]')
        .isVisible({ timeout: 500 }).catch(() => false);
      if (discardOpen) {
        log(`  [modal] Dismissing unexpected discard dialog before Next...`);
        await page.locator('button:has-text("Continue applying")').click().catch(() => {});
        await page.waitForTimeout(400);
      }
      const nextBtn = modal.locator('button[aria-label="Continue to next step"], button:has-text("Next")').first();
      await humanClick(nextBtn, page);
      log(`  [modal] Step ${step}: clicked "Next"`);
    } else {
      // No navigation button found — take a screenshot for debugging and bail
      warn(`  [modal] No navigation button at step ${step} for "${job.title}" — discarding`);
      await modal.locator('button[aria-label="Dismiss"]').click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator('[data-test-dialog-confirm-btn]:has-text("Discard"), button:has-text("Discard")').click().catch(() => {});
      return { status: 'error', missingFields: allMissing };
    }
  }

  warn(`  [modal] Exceeded step limit for "${job.title}" — discarding`);
  await modal.locator('button[aria-label="Dismiss"]').click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-test-dialog-confirm-btn]:has-text("Discard"), button:has-text("Discard")').click().catch(() => {});
  return { status: 'error', missingFields: allMissing };
}

// ─── Eligibility helpers ──────────────────────────────────────────────────────

// Extract the first "X years experience" mention from a job description (lowercase).
function extractRequiredExp(desc: string): string {
  const m = desc.match(/\b(\d[\d\-–+]*)\s*(?:to\s*\d+\s*)?years?\s*(?:of\s*)?(?:experience|exp|work\s+experience|professional\s+experience)\b/i);
  return m ? m[0].trim() : 'Not specified';
}

// ─── Job description filter ───────────────────────────────────────────────────
//
// Reads the job description already loaded in the detail panel and returns false
// if it clearly doesn't match Kartik's profile (2026 fresher, JS/TS/React/Node/Python).
// Defaults to true (apply) when the description is ambiguous or unreadable.

async function shouldApply(page: Page, job: JobCard): Promise<boolean> {
  const descText = await page.locator([
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content',
    '[class*="jobs-description"]',
    '.job-details-jobs-unified-top-card__job-insight',
  ].join(', ')).first().textContent({ timeout: 4_000 }).catch(() => '');

  const desc = (descText ?? '').toLowerCase();
  if (!desc) return true; // can't read description — apply anyway

  // ── Quick title-level seniority check before reading the description ──────────
  const titleSkip = /\b(senior|sr\b|sr\.|lead\s+engineer|tech\s+lead|principal|staff\s+engineer|director|head\s+of|manager|architect)\b/i;
  if (titleSkip.test(job.title)) {
    log(`  [filter] SKIP "${job.title}" at ${job.company} — title-level seniority`);
    return false;
  }

  // ── Hard skip: seniority / experience level out of range ─────────────────────
  const senioritySkip = /\b(senior|sr\b|lead\s+engineer|tech\s+lead|principal|staff\s+engineer|director|head\s+of\s+engineering|vp\s+of\s+engineering|vice\s+president|manager|architect)\b/;
  // Match "2+ years", "3 years", "8-10 years", etc. — skip anything requiring 2 or more years (candidate is fresher)
  const expSkip = /\b([2-9]|[1-9]\d)\+?\s*(?:to\s*\d+\s*)?\s*years?\s*(?:of\s*)?(?:experience|exp|work experience|professional experience)\b/;

  // ── Hard skip: specific tech Kartik doesn't have ──────────────────────────────
  const techSkip = /\b(golang|go lang|\brust\b|kotlin\b|swift\b|embedded\s*c\b|vlsi|verilog|vhdl|sap\s*abap|abap\b|salesforce|blockchain|solidity|smart\s*contract|devops.only|site\s*reliability|network\s*engineer|hardware\s*engineer|firmware)\b/;

  for (const [name, pat] of [['seniority', senioritySkip], ['experience', expSkip], ['tech', techSkip]] as [string, RegExp][]) {
    if (pat.test(desc)) {
      log(`  [filter] SKIP "${job.title}" at ${job.company} — ${name} mismatch`);
      return false;
    }
  }

  return true; // passes all filters — go ahead and apply
}

// ─── Application runner ───────────────────────────────────────────────────────

async function applyToJob(page: Page, job: JobCard, searchUrl: string): Promise<{ status: ApplicationStatus; missingFields: string[] }> {
  log(`\n  [apply] "${job.title}" — ${job.company}`);

  if (page.isClosed()) return { status: 'error', missingFields: [] };

  // Ensure we're on the search results page — clicking a card there opens the job
  // in the right-panel split-pane where Easy Apply button is always present.
  // Navigating to the standalone /jobs/view/ page uses a different DOM layout
  // where LinkedIn omits the Easy Apply button entirely.
  const currentUrl = page.url();
  if (!currentUrl.includes('/jobs/search')) {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
  }

  // Click the job card in the left list to open it in the right-pane detail view.
  // LinkedIn virtualises the list so the card may not be in DOM — try title link fallback.
  const cardSelector = `li[data-occludable-job-id="${job.id}"], li[data-job-id="${job.id}"]`;
  let cardFound = false;
  try {
    const card = page.locator(cardSelector).first();
    const cardInDom = await card.isVisible({ timeout: 3_000 }).catch(() => false);
    if (cardInDom) {
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await humanClick(card, page);
      cardFound = true;
      log(`  [apply] Clicked job card in search results panel`);
    }
  } catch {}

  if (!cardFound) {
    // Card not visible (virtualized) — try clicking the title link (also opens right panel)
    const titleLink = page.locator(`a[href*="${job.id}"]`).first();
    const linkVisible = await titleLink.isVisible({ timeout: 3_000 }).catch(() => false);
    if (linkVisible) {
      await titleLink.scrollIntoViewIfNeeded().catch(() => {});
      await humanClick(titleLink, page);
      cardFound = true;
      log(`  [apply] Clicked title link for job ${job.id} in search results`);
    }
  }

  if (!cardFound) {
    // Last resort: navigate directly to the job URL (standalone page — may lack Easy Apply)
    warn(`  [apply] Card not found in search results — falling back to direct URL navigation`);
    if (job.url) {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
    }
  }

  if (page.isClosed()) return { status: 'error', missingFields: [] };
  await page.waitForTimeout(2_500);  // wait for LinkedIn's JS to fully render the detail panel

  // Wait for the job detail view to finish loading.
  // On /jobs/view/ pages the top-card renders outside any split-pane wrapper.
  const detailPanel = page.locator([
    '.scaffold-layout__detail',               // split-pane right panel (search results page)
    '.jobs-search__job-details--wrapper',     // alternate split-pane wrapper
    '.jobs-unified-top-card',
    '.job-details-jobs-unified-top-card',     // 2025+ LinkedIn DOM
    '.jobs-details-top-card-container',       // alternate 2025 class
    '.jobs-details',
    '.jobs-view-layout',                      // standalone /jobs/view/ page layout (fallback)
  ].join(', ')).first();
  await detailPanel.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {
    warn('  [apply] Detail panel did not appear — will try anyway');
  });
  await page.waitForTimeout(500);

  // ── Job description filter — skip if description doesn't match profile ────────
  // Read description for ELIGIBILITY block before calling shouldApply
  const descForElig = await page.locator([
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content',
    '[class*="jobs-description"]',
  ].join(', ')).first().textContent({ timeout: 4_000 }).catch(() => '');
  const requiredExp = extractRequiredExp((descForElig ?? '').toLowerCase());

  const fits = await shouldApply(page, job);
  const verdict = fits ? 'APPLY' : 'SKIP';
  const reason  = fits ? 'Passes all filters' : 'Seniority / experience / tech mismatch';
  log(`\nELIGIBILITY: ${job.title} @ ${job.company} | Required Exp: ${requiredExp} | Candidate: Fresher | Verdict: ${verdict} | Reason: ${reason}`);

  if (!fits) {
    return { status: 'skipped', missingFields: [] };
  }

  // Check if already applied (detail panel shows a clear "Applied" status badge)
  // Use precise selectors only — avoid broad span:has-text("Applied") which false-positives
  // on "X people applied" or applicant count text
  const alreadyAppliedBadge = await detailPanel
    .locator([
      '.jobs-unified-top-card__content--two-pane .jobs-s-apply--applied',
      'li.job-details-jobs-unified-top-card__job-insight:has-text("Applied")',
      '.artdeco-inline-feedback--success:has-text("Applied")',
    ].join(', '))
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
  if (alreadyAppliedBadge) {
    log(`  [apply] Detail panel shows "Applied" badge — skipping`);
    return { status: 'already_applied', missingFields: [] };
  }

  // Find the Easy Apply button — scoped to detail panel, then page-wide fallback
  // LinkedIn frequently changes class names and aria-label wording — use multiple selectors.
  const easyApplySelectors = [
    'button[aria-label^="Easy Apply to"]',
    'button[aria-label="Easy Apply"]',
    'button[aria-label*="Easy Apply"]',
    'button.jobs-apply-button--top-card',
    'button.jobs-apply-button',
    'button:has-text("Easy Apply")',
    '.jobs-s-apply button',                     // 2025+ wrapper structure
    '.jobs-apply-button button',                // alternate wrapper
  ].join(', ');

  let easyApplyBtn = detailPanel.locator(easyApplySelectors).first();

  let btnVisible = await easyApplyBtn.isVisible({ timeout: 5_000 }).catch(() => false);

  // Fallback: page-wide search (in case detail panel selector missed)
  if (!btnVisible) {
    easyApplyBtn = page.locator([
      'button[aria-label^="Easy Apply to"]',
      'button[aria-label="Easy Apply"]',
      'button[aria-label*="Easy Apply"]',
      'button.jobs-apply-button',
      '.jobs-s-apply button',
      'button:has-text("Easy Apply")',          // standalone /jobs/view/ page — button has text but no aria-label
    ].join(', ')).last();  // .last() picks the detail panel button (appears after list buttons)
    // Use waitFor attached (not visible) — LinkedIn's standalone layout can render the button
    // inside a container that Playwright considers non-visible due to CSS overflow/transform,
    // even though the button is visually rendered on screen.
    btnVisible = await easyApplyBtn.waitFor({ state: 'attached', timeout: 5_000 })
      .then(async () => {
        // If attached, try scrolling into view and check again
        await easyApplyBtn.scrollIntoViewIfNeeded().catch(() => {});
        return true;
      })
      .catch(() => false);
  }

  if (!btnVisible) {
    // Diagnostic: log all buttons in the job header so we can see what LinkedIn rendered
    const allBtns = await page.locator('.jobs-unified-top-card button, .job-details-jobs-unified-top-card button, .jobs-s-apply button, .jobs-details button').all();
    for (const b of allBtns) {
      const lbl = await b.getAttribute('aria-label').catch(() => '');
      const txt = await b.textContent().catch(() => '');
      log(`  [debug] Button — aria-label="${lbl}" text="${txt?.trim()}"`);
    }
    // Take a screenshot of the full page so we can see exactly what LinkedIn rendered
    const screenshotsDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotsDir, 'debug-no-easy-apply-btn.png'), fullPage: true }).catch(() => {});
    warn(`  [apply] "Easy Apply" button not found — screenshot saved to screenshots/debug-no-easy-apply-btn.png — queuing for retry`);
    return { status: 'error', missingFields: [] };
  }

  // Check if the button is disabled (e.g. Motorola-style "applied elsewhere" or quota-limited jobs)
  const isDisabled = await easyApplyBtn.isDisabled().catch(() => false);
  if (isDisabled) {
    warn(`  [apply] Easy Apply button is disabled — skipping "${job.title}"`);
    return { status: 'skipped', missingFields: [] };
  }

  await humanClick(easyApplyBtn, page);
  await randomDelay(page, CONFIG.delays.afterClick);

  // Check if the Easy Apply modal appeared.
  // Use multiple selectors in priority order — LinkedIn has changed this class before.
  // Specific IDs first, then generic role="dialog" (fallback — also matches cookie banners so keep it last)
  const modal = page.locator([
    '[data-test-modal-id="easy-apply-modal"]',  // most specific 2025+ LinkedIn attr
    '[data-modal-id="easy-apply-modal"]',        // alternate attr name LinkedIn uses
    '.jobs-easy-apply-modal',                    // legacy class-based selector
    '[data-test-modal]',                          // generic test modal
    'div[role="dialog"]',                         // last-resort: any dialog
  ].join(', ')).first();
  const modalVisible = await modal.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false);

  if (!modalVisible) {
    // External apply — a new tab may have opened; only close tabs on non-LinkedIn domains
    const allPages = page.context().pages();
    let closedExternal = false;
    for (const p of allPages) {
      if (p !== page) {
        const tabUrl = p.url();
        if (!tabUrl.includes('linkedin.com')) {
          await p.close().catch(() => {});
          closedExternal = true;
          log('  [apply] External application page detected and closed — skipping');
        }
      }
    }
    if (!closedExternal) {
      warn('  [apply] Modal did not appear (no external tab opened) — skipping');
    }
    return { status: 'skipped', missingFields: [] };
  }

  log('  [modal] Easy Apply modal opened');

  // Handle "Already applied" state (modal opens immediately with confirmation)
  const alreadyApplied = await modal
    .locator("h3:has-text(\"You've already applied\"), .artdeco-inline-feedback--success")
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  if (alreadyApplied) {
    log('  [apply] Already applied to this job — skipping');
    await modal.locator('button[aria-label="Dismiss"]').click().catch(() => {});
    return { status: 'already_applied', missingFields: [] };
  }

  return await walkModal(page, modal, job);
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printSummary(records: ApplicationRecord[]): void {
  const session = records.filter(r => r.appliedAt && new Date(r.appliedAt) > new Date(Date.now() - 3_600_000));
  log('\n' + '='.repeat(72));
  log(`  LINKEDIN EASY APPLY — SESSION SUMMARY`);
  log('='.repeat(72));

  const tableData = session.map((r, i) => ({
    '#':        i + 1,
    'Status':   r.status,
    'Title':    r.title.length > 32 ? r.title.slice(0, 30) + '..' : r.title,
    'Company':  r.company.length > 24 ? r.company.slice(0, 22) + '..' : r.company,
    'Applied':  r.appliedAt ? r.appliedAt.slice(0, 19).replace('T', ' ') : '-',
  }));

  if (tableData.length > 0) {
    console.table(tableData);
  } else {
    log('  No applications in this session.');
  }

  log(`\n  Full log: ${OUTPUT_FILE}`);
  log('='.repeat(72));
}

function printExtraInfoReport(records: ApplicationRecord[]): void {
  const session = records.filter(r => r.appliedAt && new Date(r.appliedAt) > new Date(Date.now() - 3_600_000));
  const needsExtra = session.filter(r => r.missingFields && r.missingFields.length > 0);

  log('\n' + '═'.repeat(72));
  log('  JOBS REQUIRING EXTRA INFORMATION');
  log('═'.repeat(72));

  if (needsExtra.length === 0) {
    log('  All applications were completed with pre-configured answers. Nothing extra needed.');
  } else {
    needsExtra.forEach((r, i) => {
      log(`\n  ${i + 1}. "${r.title}" at ${r.company}`);
      log(`     URL: ${r.url}`);
      log(`     Missing fields:`);
      r.missingFields.forEach(f => log(`       - ${f}`));
    });
  }

  log('\n' + '═'.repeat(72));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const globalBugs: string[] = [];

  log('');
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║   LinkedIn Easy Apply Automation                             ║');
  log('╠══════════════════════════════════════════════════════════════╣');
  log(`║  Keywords : ${CONFIG.keywords.padEnd(48)} ║`);
  log(`║  Location : ${CONFIG.location.padEnd(48)} ║`);
  log(`║  Max apps : ${String(CONFIG.maxApplications).padEnd(48)} ║`);
  log('╚══════════════════════════════════════════════════════════════╝');
  log('');
  log('  HOW TO USE — for best results:');
  log('  1. Close all Chrome windows.');
  log('  2. Open a terminal and run:');
  log('       "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
  log('  3. Log in to LinkedIn in that browser window.');
  log('  4. Run this script.  (If Chrome is unavailable, skip steps 1-3.)');
  log('');

  const existingRecords = loadApplications();
  log(`  [data] Loaded ${existingRecords.length} existing application record(s) for dedup.`);

  const { context, cdpConnected } = await launchBrowser();

  const existingPages = context.pages();
  const page = existingPages.length > 0 && cdpConnected ? existingPages[0] : await context.newPage();

  page.on('console', msg => {
    // Filter out noisy ERR_FAILED resource errors (LinkedIn ad/tracking calls blocked by Playwright)
    if (msg.type() === 'error' && !msg.text().includes('ERR_FAILED') && !msg.text().includes('net::')) {
      globalBugs.push(`JS: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    // Filter out minified React hydration errors which are harmless in this context
    if (!err.message.includes('Minified React error')) {
      globalBugs.push(`PageError: ${err.message}`);
    }
  });

  try {
    await ensureLoggedIn(page);

    // ── Retry queue: jobs that failed in previous runs are attempted first ────────
    const retryQueue = loadRetryQueue();
    if (retryQueue.length > 0) {
      log(`\n  [retry] ${retryQueue.length} job(s) in retry queue — attempting them first.`);
    }

    const searchUrl = buildSearchUrl();
    log(`\n  [search] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await dismissLinkedInModals(page);
    await page.waitForTimeout(2_000);

    const freshJobs = await collectJobCards(page);

    // Retry-queue jobs go first — but ONLY those that also appear in fresh results
    // (so we can click them from the search panel). Jobs not in fresh results have
    // expired / been removed; they keep failing via direct URL, so discard them.
    const freshIds = new Set(freshJobs.map(j => j.id));
    const validRetries = retryQueue.filter(j => freshIds.has(j.id));
    const stalePurged  = retryQueue.filter(j => !freshIds.has(j.id));
    for (const j of stalePurged) {
      removeFromRetryQueue(j.id);
      log(`  [retry] Purged stale retry (not in current results): "${j.title}"`);
    }
    const jobs = [
      ...validRetries,
      ...freshJobs.filter(j => !validRetries.some(r => r.id === j.id)),
    ];

    if (jobs.length === 0) {
      log('  [jobs] No Easy Apply jobs found. Try adjusting keywords or location in CONFIG.');
      return;
    }

    let submitted = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const job of jobs) {
      if (submitted >= CONFIG.maxApplications) {
        log(`\n  [done] Reached maxApplications limit (${CONFIG.maxApplications}). Stopping.`);
        break;
      }

      // Dedup check
      if (isAlreadyApplied(job.id, existingRecords)) {
        log(`  [skip] Already applied (previous run): "${job.title}"`);
        continue;
      }

      let status: ApplicationStatus = 'error';
      let errorDetail: string | null = null;
      let missingFields: string[] = [];

      try {
        if (page.isClosed()) { warn('  [apply] Page closed — stopping.'); break; }
        await randomDelay(page, CONFIG.delays.betweenApplications);
        ({ status, missingFields } = await applyToJob(page, job, searchUrl));
      } catch (err) {
        errorDetail = (err as Error).message;
        warn(`  [apply] Error applying to "${job.title}": ${errorDetail}`);
        globalBugs.push(`apply error: ${job.title}: ${errorDetail}`);
        status = 'error';

        // Only try to clean up the modal if the page is still alive
        const pageAlive = !page.isClosed();
        if (pageAlive) {
          // Close any lingering modal
          await page.locator([
            '.jobs-easy-apply-modal button[aria-label="Dismiss"]',
            '[data-test-modal] button[aria-label="Dismiss"]',
            'div[role="dialog"] button[aria-label="Dismiss"]',
          ].join(', ')).first().click().catch(() => {});
          await page.waitForTimeout(500).catch(() => {});
          await page.locator('button:has-text("Discard")').click().catch(() => {});
        } else {
          warn(`  [apply] Page was closed — queuing job for retry and stopping session`);
          addToRetryQueue(job);
          break;
        }
      }

      const record: ApplicationRecord = {
        id:            job.id,
        title:         job.title,
        company:       job.company,
        url:           job.url,
        appliedAt:     status === 'submitted' ? new Date().toISOString() : null,
        status,
        errorDetail,
        missingFields,
      };

      // Only persist submitted and already_applied records.
      // Discarded/errored jobs (form failed mid-way) go into the retry queue.
      // Eligibility-filtered skips are NOT retried — they will never pass the filter.
      if (status === 'submitted' || status === 'already_applied') {
        appendApplication(record);
        existingRecords.push(record);  // update in-memory dedup list
        removeFromRetryQueue(job.id);  // successfully handled — remove from retry queue
      } else if (status === 'error') {
        warn(`  [apply] Not saving "${job.title}" (status: error) — queuing for retry`);
        addToRetryQueue(job);
      } else {
        // status === 'skipped' — eligibility filter rejected it, don't retry
        warn(`  [apply] Not saving "${job.title}" (status: ${status}) — skipped by filter`);
        removeFromRetryQueue(job.id);  // remove from retry queue — it will always be filtered
      }

      if (status === 'submitted')      submitted++;
      else if (status === 'skipped' || status === 'already_applied') skipped++;
      else                             errors++;

      log(`  [progress] submitted: ${submitted}/${CONFIG.maxApplications} | skipped: ${skipped} | errors: ${errors}`);
    }

    printSummary(existingRecords);
    printExtraInfoReport(existingRecords);

  } catch (err) {
    const msg = `Fatal error: ${(err as Error).message}`;
    warn(`\n  [FATAL] ${msg}`);
    globalBugs.push(msg);
    throw err;
  } finally {
    if (globalBugs.length > 0) {
      log('\n  Bugs / warnings this run:');
      globalBugs.forEach((b, i) => log(`    ${i + 1}. ${b}`));
    }
    await context.close().catch(() => {});
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\nScript failed:', err.message);
  process.exit(1);
});
