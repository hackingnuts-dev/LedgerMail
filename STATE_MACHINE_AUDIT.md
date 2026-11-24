# LedgerMail: explicit state-machine review (November 2026)

This audit describes finite-state boundaries implemented in the browser. It does NOT claim all possible bugs have been eliminated. web/engine.js defines allowed transitions; unauthorized transitions throw rather than silently mutate business state.

## State machines
| Area | States | Invariants |
|---|---|---|
| Gmail OAuth | DISCONNECTED, CONNECTING, VERIFYING, CONNECTED, EXPIRED, ERROR | Scanning requires CONNECTED. Verify email address before loading that account's IndexedDB history. Do not persist OAuth tokens. |
| Finance scan | IDLE, RUNNING, COMPLETE, PARTIAL, ERROR | One scan at a time; discard stale async results by account and generation; show partial results as partial. |
| Local storage | BOOTING, LOADING, READY, SAVING, ERROR | Serialize IndexedDB writes; partition snapshots by Gmail address; report failed saves; delete aborts in-flight sync. |
| Financial review | REVIEW, PAID, DUE, IGNORED | Evidence is a suggestion, not verified payment. Only user review changes financial status. Save review after every change. |
| Navigation | dashboard, payments, bills, inbox, settings | One active route and selected tab; invalid transitions are rejected. |
| Gmail inbox | IDLE, LOADING, READY, ERROR | Single-flight pagination, stale account result checks, and disabled controls while fetching. |
| Backup | IDLE, READING, VALIDATING, WRITING, EXPORTING, DONE, ERROR | Schema validation, confirmation before import, and no credential export. |

## Regression coverage
- web/engine.test.mjs: receipts, OTP suppression, dates, currencies, duplicate detection, state transitions and review retention
- web/store.test.mjs: per-account serialization and credential-exclusion schema
- web/ui.test.mjs: simulated iPhone PWA open/reopen, $285 breakdown, paid review persistence, filters, account isolation, offline history

## Known limitations
- An email is not authoritative proof of a bank-settled payment or unpaid bill.
- Each scan examines up to 300 matching emails from the preceding 90 days, retaining older saved candidates.
- IndexedDB is on-device storage, NOT end-to-end encrypted or cloud synced. Safari may clear it; export sensitive local backups.
- Google's browser token model requires user-triggered reconnection after access token expiry or re-opening the app; no refresh token is stored.
- Gmail's read-only scope is restricted, so broad public authorization requires Google's verification process.
- Netlify's current Actions publishing credential can expire and require renewal or a permanent Git-based deployment configuration.

These controls reduce hidden state/race risks, but do not guarantee that the app has zero defects.

## v5 Primary full-message financial ingestion
- Gmail API list requests always include CATEGORY_PRIMARY and a Primary-only query excluding Promotions, Social, Updates and Forums. Each full message must also carry CATEGORY_PRIMARY and no excluded category.
- Only Gmail format=full MIME bodies are parsed for financial classification. Non-text attachments are ignored and subject-only/preview-only matches never count.
- Classifier is conservative, rejecting OTPs, advertisement/promotional wording, refunds, inbound deposits, and ambiguous amounts without payment context.
- Strict receipts populate the compact financial dashboard; less certain classifications remain behind a user-initiated review queue; bills never count as purchases.
- v4 metadata-only matches are quarantined in local legacy history, excluded from all amounts until a fresh Primary full-body scan. No automatic approval of historic transactions.
- Full email text is temporary and never stored as a full message; an evidence excerpt is stored with explicit provenance and classifier version.
- Classification errors and unscanned messages are reflected as incomplete/partial status, never as a guaranteed exhaustive statement.
- Outstanding limitation: Gmail classification is not proof of sender authenticity, card ownership or final bank settlement.
