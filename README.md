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


## Version 4: persistent local history and explicit review
- Click the monthly amount to see category, transaction and paid/unpaid breakdown.
- A financial email creates a **candidate**, not proof that a bank payment settled or a bill remains due. Choose Mark paid, Due / unpaid, or Ignore manually.
- OTP and verification messages are filtered; duplicate messages are flagged. The parser does not guarantee full bank reconciliation.
- Per-account finance summaries and review decisions are saved in IndexedDB and reloaded after the PWA is closed. No Gmail access or refresh tokens are saved. IndexedDB is device/browser-specific and may be cleared by Safari or the user.
- Disconnecting Gmail keeps saved finance history. Deleting history is a separate confirmed action.
- Export JSON to make your own **sensitive** local backup, or restore a JSON backup; store the file privately.
- Google Identity Services' browser token model requires a user action to acquire a fresh short-lived token. This static, free-hosted app therefore cannot promise permanent automatic Gmail sign-in/background synchronization: use Reconnect Gmail, which reuses existing Google consent when possible. A continuously connected Gmail service would require a secure server-side OAuth code flow and refresh-token vault.
- Authentication, synchronization, storage and payment review have explicit state transition guards with regression tests.
- Version 4 stores historical candidate records from past scans but scans only a window of recent emails per manual/connected synchronization.

## v5: Quiet financial intelligence (Primary only)
- The financial scanner queries only Gmail Primary (label CATEGORY_PRIMARY), excludes Promotions, Social, Updates, Forums, Spam, Trash, and checks each returned message category again.
- The scanner fetches **format=full**, reads and decodes MIME text/plain (or sanitized HTML text fallback) and analyzes the actual email body. Subject/preview alone never creates a transaction.
- Promotional content, OTPs, refunds and incoming deposits are filtered. Strict amount-to-payment evidence rules choose total paid, not price advertisements/subtotals.
- The home page includes only high-confidence completed-looking receipts; no ambiguous items in the monthly amount. Bills have their own section, and uncertain emails are hidden behind a small review button.
- Emails remain **not bank-verified**; absence of an email is not proof no transaction occurred. 'Likely completed' refers to email evidence, not account settlement.
- Old v4 subject-only matches are quarantined and excluded from totals on next open; a new scan is required to rebuild trustworthy items. Those old records can be exported as part of the local backup.
- The app processes full mail text only in memory, storing short evidence excerpts. Gmail access tokens remain transient, with no server.
- Scans have a 90-day query window and maximum 300 matching Primary messages per pass; partial scans are explicitly labeled. Gmail category filtering can omit legitimate financial messages that Gmail has placed in Updates.
