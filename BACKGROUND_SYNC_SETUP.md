# LedgerMail Build 18 — Persistent Gmail background sync

This branch introduces **server-side** Gmail authorization and a scheduled incremental mailbox sync.
It does not automatically activate until a Netlify site is configured with the secrets below and
a server-side OAuth client is authorized. Do not merge or deploy blindly.

## Why it is needed

iOS suspends browser/PWA JavaScript after the phone locks. A service worker cannot be relied on
to poll Gmail indefinitely. The Netlify scheduled function works independently of the device.
The browser reads encrypted-at-rest cached mail when opened; financial classification stays in
the browser, and locally reviewed statuses remain local.

## Required Netlify environment variables (runtime)

- `GOOGLE_CLIENT_ID`: Google Cloud OAuth **Web application** client ID.
- `GOOGLE_CLIENT_SECRET`: matching OAuth **Web application** client secret.
- `LEDGERMAIL_PUBLIC_URL`: exact https origin of the deployed app, e.g.
  `https://your-ledgermail-site.netlify.app` (no trailing slash).
- `LEDGERMAIL_SESSION_SECRET`: cryptographically random secret, **32+ characters**.
- `LEDGERMAIL_DATA_KEY`: 32 random bytes encoded as base64.

Create secrets locally using Node:
```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Generate different independent values for the session secret and encryption key.
Save these in **Netlify environment settings** (not GitHub and not the browser).

Under Google Cloud > OAuth client, add this exact authorized redirect URI:
`https://your-ledgermail-site.netlify.app/.netlify/functions/mail?action=callback`

Keep the Gmail API enabled and grant **gmail.readonly**, `openid`, and `email`.
If the OAuth consent app is in **Testing**, Gmail refresh tokens can expire after seven days.
Move to the appropriate **In production** status and fulfill any Google verification/security
requirements; do not make the application public until access and verification are reviewed.
Initial authorization still requires the user's explicit Google consent. A revoked token,
changed scope, deleted server data, or expired client session will require reconnecting.

## Deployment behavior

1. Install packages with `npm install` (Netlify also installs dependencies during builds).
2. Publish directory is `web` as configured in `netlify.toml`; functions live in
   `netlify/functions`.
3. Netlify `mail-schedule` runs approximately **every 10 minutes**, not instantly.
   It incrementally reads Gmail history and refetches a recent window if its history
   cursor has expired.
4. The first connection queues an asynchronous background backfill for up to 32 days.
   Scheduled runs resume incomplete backfills and collect later changes. The app can still manually scan a selected historical month.
5. Verify the Netlify Functions dashboard lists `mail`, `mail-schedule`, and
   `mail-scan-background`. OAuth credentials must be provisioned before the flow is usable.
6. Open LedgerMail, choose **Connect Gmail** and complete the Google consent screen once.
   The session is stored as an HttpOnly, Secure, SameSite cookie (90 days, renewed on use).
7. Once active, the phone can be locked. The server will continue checking for mail; open
   the app to pull cached changes and classify financial email locally.
8. Review Netlify Functions logs for `mail-schedule` and observe `syncStatus` in the app.
   The current design polls rather than using Gmail Pub/Sub push. It's periodic, not
   real-time delivery.

## Security and scope

- **No browser-side refresh tokens.** Refresh credentials and raw cached messages are
  encrypted in Netlify Blobs with AES-256-GCM; server secrets are environment variables.
- Each mailbox is segregated by an HMAC-derived account ID. Sessions use signed cookies.
- Cached message bodies are sensitive. Limit access to the Netlify project and keep a
  data-retention/deletion policy appropriate for financial emails.
- **Disconnect Gmail** deletes that mailbox's server data. Local history remains on device.
- This version keeps a maximum of 500 cached raw messages per mailbox and imports them
  in batches. It does not continuously process *all* old mail or run a 24/7 phone task.
- Netlify scheduled functions have runtime limits and invocation quotas. Monitor your
  account limits and cost before scaling to many accounts.
- A valid Google OAuth consent and production deployment are required to test the entire
  end-to-end flow. No secrets are bundled with the repository.

## Acceptance checklist

- [ ] Deploy preview builds and serves functions without syntax errors
- [ ] Both intended Gmail accounts complete server-side consent
- [ ] Reload the app / update the PWA: session remains connected
- [ ] Lock the iPhone; send a new Gmail message; check Netlify scheduled logs after a run
- [ ] Open the app: new messages import once, reviewed status is preserved
- [ ] Reconnect only after an explicit revoke/expiry
- [ ] Disconnect one account: its server credentials and cached messages are deleted
- [ ] Test a recent month and a historical month; verify no missed financial candidates
- [ ] Confirm deployment cost and Google Cloud quota behavior

## Remaining follow-up

For near-real-time notification delivery, configure **Gmail watch + Google Pub/Sub** and
renew the mailbox watch before expiration. That requires a separately configured Pub/Sub
project and secured webhook endpoint, not merely changing a browser timer.
