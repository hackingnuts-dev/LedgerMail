# LedgerMail — free iPhone PWA

Private-source, local-session Gmail and bill analysis web app. App source: [web/](web/).

## Included
- Responsive iPhone dashboard, expenses, bills, inbox and settings
- Google Identity Services OAuth 2.0 token client with read-only Gmail scope
- On-demand scans of recent emails; subject/snippet amount candidate extraction
- Review states for payment and bill candidates; session-only analysis
- Offline app shell, manifest and icon; GitHub Pages deployment workflow

## Current deployment blockers
**Repository is private.** On GitHub Free, GitHub Pages requires a public repository; on supported paid plans private repos can deploy Pages, but resulting site is public. Do not change repository visibility without approval. The workflow is included but a live Pages site is not guaranteed.

## Google OAuth configuration (necessary before Gmail works)
1. In Google Cloud Console, create a project and enable Gmail API.
2. Configure OAuth consent and add your Google account as a test user if the app is in Testing mode.
3. Create an **OAuth Client ID → Web application** and add your actual deployed site origin, e.g. `https://hackingnuts-dev.github.io` (origin only; not /LedgerMail).
4. Copy the **client ID** (never a client secret) to LedgerMail Settings. Click Connect Gmail and approve read-only access.
5. Google may require restricted-scope verification for general public use. Do not put tokens or client secrets in GitHub.

## Install on iPhone
Visit the deployed HTTPS URL in Safari → Share → Add to Home Screen. No Developer Mode, TestFlight or Apple Developer subscription required.

## Security and limitations
- Gmail access token only in JavaScript memory; no server, telemetry or analytics.
- Financial candidate data are session-only in memory, not synced or encrypted at rest.
- Amounts are heuristics from email **subject and preview** only, with USD assumption; missing amounts, duplicates and false positives are possible.
- Confirmed payment is a user review state, not a bank-confirmed settlement.
- A bill candidate is not an outstanding balance; due dates and reminders require future improvements.
- Gmail access requires reconnecting after refresh/session expiry.
- Offline mode shows only the app shell; Gmail requires internet.

## Checks
`node --check web/app.js && node --check web/sw.js && node web/tests.mjs`

Never commit Gmail messages, OAuth secrets, private personal data, signing keys or provisioning files.

## Any Gmail account / switching
The app accepts any Gmail identity returned by the Gmail profile endpoint after the owner grants read-only OAuth access. Connected email is shown in Settings. Disconnect or choose Connect Gmail to switch; account-specific financial and inbox data are cleared immediately before switching to prevent cross-account mixing. Each account must authorize access independently. Google OAuth projects in Testing mode restrict who can authorize the app (add test users); broader distribution may require Google's restricted-scope verification.
