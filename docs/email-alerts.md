# Email alerts

Email alerts for the teams a signed-in fan follows (ADR 0053), and the weekly digest (ADR 0055). Opt-in, 18 or older by birth year (ADR 0056), plain
emails, sent through Resend. This page is how it works and what the owner sets up.

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
| The link's shape (token), the site switch | `apps/web/lib/email/unsubscribe.ts`, `config.ts` |
| Unsubscribe route and pages | `apps/web/app/api/email/unsubscribe/route.ts`, `app/account/email/unsubscribe*/page.tsx` |
| Which events exist (finals, kickoffs, next games) | `tools/email/events.mjs` |
| The email (subject, text, HTML, headers) | `tools/email/message.mjs` |
| Resend call (outcome classes, idempotency key) | `tools/email/resend.mjs` |
| The run | `tools/email/send-game-alerts.mjs`, `.github/workflows/email-alerts.yml` |

## The weekly digest (ADR 0055)
One email on Monday morning to each fan who opted in, covering every team they follow. The pieces it reuses are the alerts' own:
`email_kind` has `weekly_digest`; `email_optin`, `email_sent` (`item` = the ISO week, `2026-w47`), `email_set_optins(kind, slugs)`,
`email_my_settings()`, `email_unsubscribe(token)` and `email_mark_sent` do not care which kind they hold. A fan has one unsubscribe
token per kind, so a digest link turns the digest off and nothing else.

**What a fan sees.** On `/account`, under Email alerts: a "Weekly digest" box with its own save ("Email me the weekly digest", "Save
weekly digest"), off until saved, for every team they follow (those followed later too). Same adult rule as the alerts. Each digest has,
per team: *Last week* (the confirmed final, or "No game last week" / "No confirmed result yet"), *Ranking* ("#4 in Division I, up 2
places from #6"; the rankings pages' own rank and move) and *Next game* (with the day and kickoff when known, and each side's chance
to win; "No game scheduled" when none). It ends with why they got it, a link to change it, an Unsubscribe link (List-Unsubscribe plus
One-Click Post too) and the postal address. A fan none of whose teams has a result or a next game is sent nothing that week.

| Piece | Where |
|---|---|
| Opt-in box and save | `apps/web/app/account/email-alerts-form.tsx` (`WeeklyDigest`), `email-actions.ts` (`saveEmailDigest`) |
| Who is due a week | `packages/db/migrations/0025_email_digest.sql` (`email_pending_digests`, granted to `email_sender` only) |
| A team's last result, ranking move, next game, chance to win | `tools/email/digest-data.mjs` (held to the site's rules by `apps/web/scripts/email-digest-parity.test.mjs`) |
| The email (text, HTML, headers, the address footer) | `tools/email/digest-message.mjs` |
| The run | `tools/email/send-weekly-digest.mjs`, `.github/workflows/email-digest.yml` |

**How a run decides.** (1) `email_pending_digests(week)` lists the fans due this ISO week's digest: opted in, an adult, a confirmed
address, not banned, not already in `email_sent` for the week, with the teams of theirs it covers. (2) For each, the digest is built
from the repo's data (last week is Monday to Sunday before the send; the ranking move is the trend column of that Sunday against the
one before; the next game is the earliest listed game from today, or the bracket's next-round game with the date to come). (3) Sent
through Resend (about 1.6 a second) and recorded for the week; a repeat of the run skips them. A real send is allowed Monday to
Wednesday (Central) only; a dry run runs any day. The summary lists counts, never an address.

**The postal address is required.** The owner's decision of 2026-11-15: every digest carries the address in the repo variable
`EMAIL_POSTAL_ADDRESS`. While it is empty or unset the digest refuses to send, the job fails, and its summary says how many digests it
refused. Game alerts do not carry it.

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
1. **Resend:** done (Nov 14): `txsixmanfootball.com` is added to Resend.
2. **DNS:** done (Nov 14) on the owner's Cloudflare account (ADR 0014): DKIM `resend._domainkey`, the `send` and `rsend` records Resend
   asked for, and DMARC `p=none`. Wait for Resend to show the domain Verified before step 7.
3. **API key:** Resend, API Keys, create a NEW one for this job, with "Sending access" for that domain only. Not the "80x40 Supabase"
   key: that one is Supabase's SMTP key only. Do not paste it anywhere but the next step.
4. **Repo secrets and variables** (GitHub, Settings, Secrets and variables, Actions; or `gh`):
   - `gh secret set RESEND_API_KEY -R txsixman/txsixmanfootball` (type the key at the hidden prompt);
   - `EMAIL_FROM` variable: `gh variable set EMAIL_FROM -R txsixman/txsixmanfootball --body "TX Six-Man Football <no-reply@txsixmanfootball.com>"` (the same sender as the sign-in emails).
5. **The sender's database role.** Migration 0022 (applied by the Supabase workflow after the merge) creates `email_sender` with no
   login. In the Supabase SQL editor run `alter role email_sender with login password '<a long random password>';` then
   `gh secret set EMAIL_DB_PASSWORD -R txsixman/txsixmanfootball` with the same password. If the pooler refuses the role, tell the
   agent: the fallback is the owner password with the same three functions.
6. **Site switches (Vercel, production):** `EMAIL_ALERTS=on` (with `FAN_SIGNIN=on` already), then redeploy.
7. **Prove it before the switch:** Actions, Email alerts, Run workflow, tick `baseline`. Check its summary shows events found and
   nothing sent. Then set the repo variable `EMAIL_ALERTS=true` to start. (Without the baseline step the first scheduled run does
   the same thing by itself, since the first recording is always a baseline.)
8. Send yourself one: opt in on `/account` with an adult account that follows a team playing tonight; the next kickoff or final emails you.

### The weekly digest's setup (after the steps above)
Nothing in steps 1 to 6 changes; the digest uses the same Resend key, sender and database role. Migration 0025 (applied by the Supabase
workflow after the merge) gives that role its one extra function. Then:
9. **The postal address (required).** Set it as a repo variable, to an address that is not your home (a PO box or a mail service
   address). It goes at the bottom of every digest. Up to five short lines, no markup:
   `gh variable set EMAIL_POSTAL_ADDRESS -R txsixman/txsixmanfootball --body "<postal address>"` (replace the placeholder with the address).
   While it is empty or unset the digest refuses to send and the run fails.
10. **Prove it before the switch:** Actions, Weekly digest, Run workflow, leave `dry_run` ticked. The summary shows how many digests are
    due and would be sent, and nothing is sent. If it shows `REFUSED`, step 9 is not done.
11. **Switch it on:** `gh variable set EMAIL_DIGEST -R txsixman/txsixmanfootball --body true`. The Monday run (7:30 AM Central) sends it. The
    run is gated by the repo variable `LIVE` like the other weekly jobs, and GitHub's `schedule` has not been reliable here (ADR 0024), so
    if a Monday passes with no run, start Weekly digest by hand with `dry_run` unticked, any time Monday to Wednesday.
12. Send yourself one: opt in to the digest on `/account` (the site's `EMAIL_ALERTS=on` shows the box), then run it by hand on a Monday to Wednesday.

## Checks that belong to the owner
- The `/privacy` sentence about the email service (the age rule is set: 18 or older by birth year, ADR 0056).
- The weekly digest carries a postal address in its footer (the owner's decision of 2026-11-15); step 9 above sets it, and the digest refuses to send without it.
