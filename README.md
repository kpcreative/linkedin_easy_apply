# LinkedIn Easy Apply Automation

Automates LinkedIn Easy Apply job applications using Playwright (TypeScript).

## Getting Started

Open a terminal, navigate to the project folder, and run:

```bash
cd C:\Users\I769395\Desktop\browser_automation_project
npm run script:linkedin
```

The browser window will open automatically — you can watch it apply to jobs in real time.

## Tips for Best Results

For fewer LinkedIn bot-detection issues, launch Chrome with remote debugging before running the script:

1. Close all Chrome windows
2. Open a terminal and run:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
   ```
3. Log in to LinkedIn in that Chrome window
4. Then run `npm run script:linkedin` in a second terminal from the project folder

## Other Commands

| Command | What it does |
|---|---|
| `npm run script:linkedin` | Run the Easy Apply automation |
| `npm test` | Run all Playwright tests (Chromium + Firefox + WebKit) |
| `npm run test:headed` | Run tests with a visible browser |
| `npm run test:ui` | Open Playwright UI mode |
| `npm run test:report` | Open the last HTML test report |

## Output

- `data/linkedin-applications.json` — log of all applications (submitted, skipped, errors)
- `data/linkedin-retry-queue.json` — jobs that failed and will be retried next run
- `screenshots/` — debug screenshots saved on errors
