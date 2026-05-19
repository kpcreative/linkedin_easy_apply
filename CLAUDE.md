# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests (Chromium + Firefox + WebKit)
npm test

# Run tests for a single browser (faster during development)
npx playwright test --project=chromium

# Run tests with a visible browser window
npm run test:headed

# Open Playwright Inspector for step-by-step debugging
npm run test:debug

# Open Playwright UI mode (time-travel debugging, trace viewer)
npm run test:ui

# Open the last HTML test report
npm run test:report

# Run a standalone automation script
npm run script:screenshot
npx ts-node scripts/screenshot.ts

# Type-check without emitting files
npx tsc --noEmit
```

## Architecture

There are two distinct execution modes that must not be mixed:

**Standalone scripts** (`scripts/`) — use the `playwright` package directly. These run via `ts-node` with no test runner involved. The lifecycle is always: `browser.launch()` → `newContext()` → `newPage()` → work → `browser.close()` in a `finally` block. Output (screenshots, scraped data, etc.) goes to `screenshots/` or wherever the script writes it.

**Tests** (`tests/`) — use `@playwright/test`. These get `page`, `context`, and `browser` fixtures injected automatically; never manually launch a browser in a test. All tests run against `baseURL: https://playwright.dev` (set in `playwright.config.ts`) so `page.goto('/')` resolves to the full URL. Tests run across three browser projects (chromium, firefox, webkit) in parallel.

## Key Config

- `playwright.config.ts` — controls `baseURL`, timeout (30s), retries, HTML reporter, and browser projects. Change `baseURL` here when targeting a different app.
- `tsconfig.json` — uses `module: CommonJS` which is required for `ts-node` compatibility. Do not change this to ESM.
- Screenshots from failed tests are saved automatically (`screenshot: 'only-on-failure'`). Full HTML reports go to `playwright-report/`.

## Adding New Scripts

Create any `.ts` file in `scripts/` and run it with `npx ts-node scripts/my-script.ts`. Add a `package.json` entry only if it will be run frequently.

## Adding New Tests

Add `.spec.ts` files anywhere under `tests/`. They are picked up automatically. Use `getByRole` locators over CSS selectors — they are more resilient to DOM changes.
