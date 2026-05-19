import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

async function takeScreenshot(url: string, filename: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    const outputPath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(`Screenshot saved: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await takeScreenshot('https://playwright.dev', 'playwright-homepage.png');
  await takeScreenshot('https://example.com', 'example-com.png');
  console.log('Done. Check the screenshots/ directory.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
