# Email alerts

Email alerts for the teams a signed-in fan follows (ADR 0053). Opt-in, adults only, plain alerts, sent through Resend. This page
is how it works and what the owner sets up. A weekly digest builds on the same pieces.

## What a fan sees
- `/account` has an Email alerts block (when the server env `EMAIL_ALERTS` is `on`): "All the teams I follow" or one box per
  followed team, then "Save email alerts". Nothing is on until saved. An account that is not an adult sees "not available".
- Each email is one alert: a kickoff, a final, or the next-round game once the bracket sets it. It ends with why they got it, a
  link to turn it off on their account, and an Unsubscribe link. Mail apps show their own Unsubscribe button (RFC 8058).

## The pieces
| Piece | Where |
|---|---|
| Tables, functions, the `email_sender` role | `packages/db/migrations/0022_email_alerts.sql` |
| Opt-in block, save action | `apps/web/app/account/email-alerts*.tsx`, `email-actions.ts`, `lib/email/settings.ts` |
| Signed link (sign, verify), switches | `apps/web/lib/email/unsubscribe.ts`, `config.ts` |
| Unsubscribe route and pages | `apps/web/app/api/email/unsubscribe/route.ts`, `app/account/email/unsubscribe*/page.tsx` |
| Which events exist (finals, kickoffs, next games) | `tools/email/events.mjs` |
| The email (subject, text, HTML, headers) | `tools/email/message.mjs` |
| Resend call (outcome classes, idempotency key) | `tools/email/resend.mjs` |
| The run | `tools/email/send-game-alerts.mjs`, `.github/workflows/email-alerts.yml` |

## A second kind of email (the weekly digest)
- `email_kind` already has `weekly_digest`. `email_optin`, `email_sent` (`item` = the week, say `2026-w47`), `email_set_optins(kind, slugs)`,
  `email_my_settings()` and `email_unsubscribe(user, kind)` are kind-neutral. `unsubscribeUrl(…, "weekly_digest")` signs for that kind only.
- Add: a sender (a pending function like `email_pending_game_alerts`, granted to `email_sender`), its message builder, and a block
  on `/account` that calls `email_set_optins("weekly_digest", ["*"])`. `resend.mjs` and `runGameAlerts`' loop are reusable as they are.

## How a run decides
1. `events.mjs` lists the season's events from `data/seed` (finals from `games.csv` and `playoffs.csv`, kickoffs from `game-details`,
   next games from the brackets with `lib/bracket-fill.ts`).
2. `email_record_game_events` stores the new ones with the time first seen. The first call ever, or `--baseline`, stores them as
   already past: nothing is sent for them.
3. `email_pending_game_alerts` returns one row per fan and event that is due: event first seen in the last 24 hours and after the fan
   opted in and followed the team; adult, confirmed address, not banned; not in `email_sent`.
4. Each is sent (about 1.6 a second, Resend's free limit is 2), then recorded. A 5xx or timeout is retried next run; a refusal for
   good is recorded `rejected`; 429 or 401/403 stops the run (401/403 also fails it).
5. The run summary lists counts. It never prints an address, name, id or Resend's error text.

## Owner setup, in order
Nothing sends until all of this is done. Until then the job succeeds and its summary says what is missing.
1. **Resend:** make an account at resend.com, add the sending domain `txsixmanfootball.com` (Domains, Add domain, region US East).
2. **DNS** (at the domain's DNS host; Resend shows the exact values to paste, these are the records it asks for):
   - SPF: a TXT on `send` (Resend's return-path subdomain) as shown, plus an MX on `send` for bounces;
   - DKIM: the TXT `resend._domainkey` Resend shows;
   - DMARC: a TXT `_dmarc` such as `v=DMARC1; p=none; rua=mailto:contact@txsixmanfootball.com` (start with `p=none`, tighten later).
   If the domain already has an SPF or DMARC record for another sender, merge into it rather than adding a second one (two SPF records
   break both). The repo does not record what the domain's DNS holds today (not checked here). Wait for Resend to show Verified.
3. **API key:** Resend, API Keys, create one with "Sending access" for that domain only. Do not paste it anywhere but the next step.
4. **Repo secrets and variables** (GitHub, Settings, Secrets and variables, Actions; or `gh`):
   - `gh secret set RESEND_API_KEY -R txsixman/txsixmanfootball` (type the key at the hidden prompt);
   - `EMAIL_FROM` variable: `gh variable set EMAIL_FROM -R txsixman/txsixmanfootball --body "TX Six-Man Football <alerts@txsixmanfootball.com>"`.
5. **The unsubscribe secret**, one value in two places (never printed):
   `S=$(openssl rand -hex 32); printf %s "$S" | gh secret set EMAIL_UNSUBSCRIBE_SECRET -R txsixman/txsixmanfootball; printf %s "$S" | vercel env add EMAIL_UNSUBSCRIBE_SECRET production; unset S`
6. **The sender's database role.** Migration 0022 (applied by the Supabase workflow after the merge) creates `email_sender` with no
   login. In the Supabase SQL editor run `alter role email_sender with login password '<a long random password>';` then
   `gh secret set EMAIL_DB_PASSWORD -R txsixman/txsixmanfootball` with the same password. If the pooler refuses the role, tell the
   agent: the fallback is the owner password with the same three functions.
7. **Site switches (Vercel, production):** `EMAIL_ALERTS=on` (with `FAN_SIGNIN=on` already), then redeploy.
8. **Prove it before the switch:** Actions, Email alerts, Run workflow, tick `baseline`. Check its summary shows events found and
   nothing sent. Then set the repo variable `EMAIL_ALERTS=true` to start. (Without the baseline step the first scheduled run does
   the same thing by itself, since the first recording is always a baseline.)
9. Send yourself one: opt in on `/account` with an adult account that follows a team playing tonight; the next kickoff or final emails you.

## Checks that belong to the owner
- The age rule (adults only, ADR 0053 point 2) and the `/privacy` sentence about the email service.
- A postal address in the footer is required of commercial email in the US; these are alerts a fan asked for, not marketing, but the
  owner decides whether to add one before the weekly digest.
