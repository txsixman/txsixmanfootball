# ADR 0053: Email alerts for followed teams

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. The age rule (point 2, 19 years back) is waiting on
Brady's word, and nothing should be switched on until he has given it.

## Context
- Signed-in fans follow teams on their account (migration 0012). Push alerts (ADR 0021's sender, `tools/push`) reach one browser
  and never an account.
- The owner wants fans to be able to get an email when a team they follow kicks off, finishes, or has its next-round game set
  (ADR 0047). A weekly digest will follow, so the opt-in, unsubscribe, sending and flag pieces must serve a second kind of email.
- The rules that bind this: the web app never uses a service key (ADR 0018); the email address lives only in Supabase Auth; no
  minor's data goes to a third party (ADR 0018); nothing logs an address; pages and messages name no source and use no betting words.

## Decision
1. **Opt-in, never on by default.** On `/account`, a fan with an adult account chooses all the teams they follow (also those
   followed later) or individual followed teams. Nothing exists until they save. A team they stop following stops its emails.
   - `email_optin (user_id, kind, program_slug)`; `kind` is the enum `email_kind` (`game_alerts`, `weekly_digest`); `program_slug`
     `'*'` means every followed team. The digest reuses the table, the functions and the unsubscribe as they are.
   - The site reaches it only through `email_my_settings()` and `email_set_optins(kind, slugs)`, acting on `auth.uid()`'s own rows.
2. **Adults only (waiting on Brady's word).** ADR 0018 keeps any minor's data from third parties, and an email address
   sent to an email service is that. A birth year gives an age within a year, so an account is eligible only when its birth year
   is at least 19 years back (Central time): certainly 18 or older. Younger and unsure accounts see "not available for this
   account", and the database refuses their opt-in and never selects them. Relaxing it to 18 is one number in `email_adult()`.
3. **Which emails:** a kickoff (from the listed kickoff time, for three hours, while the game has no final), a final (a confirmed
   score, ADR 0040: not disputed, never a forfeit or 0-0), and the next-round game once the bracket gives it both teams
   (`lib/bracket-fill.ts`, ADR 0047, listed by a site yet or not). Plain alerts: the facts and a link to the team's page. No
   marketing, no source named, no betting word.
4. **Where sending runs and how it reads addresses:** a GitHub Actions job (`email-alerts.yml`, `tools/email/`), after every
   Results watch run, like push. Not the web app, and not with the owner's database password.
   - It connects as a dedicated role, `email_sender` (migration 0022): no login until the owner sets a password, no table right of
     any kind, and the right to run exactly three functions: `email_record_game_events`, `email_pending_game_alerts` and
     `email_mark_sent`. Those run as the database owner and are the only way an address leaves `auth.users`: one row per due
     email, for an opted-in, following, confirmed, adult, not banned fan. A leaked sender password reaches the addresses of those
     already due, not the database. Supabase's API roles cannot run them (`checkLive` fails if they can).
   - Chosen over the push sender's way (the owner's password, any table) because addresses and minors' accounts are the most
     sensitive data in the project, and over reading addresses from the web app, which ADR 0018 forbids.
5. **Dedupe.** `email_game_event` records each event once with when it was first seen; `email_sent` (append-only in practice: no
   function updates or deletes a row) records `(user, kind, alert:event)`. An email is due only when its event was first seen in the
   last 24 hours and after the fan opted in and followed the team, so switching the feature on never sends the season's past: the
   first recording ever is a baseline. Resend's `Idempotency-Key` (a hash, 24 hours) makes a retry after a crash safe. A refusal for
   good (a 4xx that is not "slow down") is recorded as `rejected` so it is not retried every ten minutes; a 5xx or timeout is retried
   on the next run inside the 24 hours; 429, 401 or 403 stops the run (and 401/403 fails it, so it is seen).
6. **Unsubscribe.** Every email has `List-Unsubscribe: <https URL>` with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
   (RFC 8058) and a link in the body. Both carry one thing: a random token (`?t=<uuid>`), made by the database for that fan and
   kind at their first opt-in (`email_unsubscribe_token`, closed to the API roles) and returned to the sender, with the address, by
   `email_pending_game_alerts` alone. No address, user id or kind is in a link.
   - `email_unsubscribe(token)` is callable by `anon`, and the token is the whole proof: it turns off that fan's opt-ins of that
     token's kind, does nothing for a token that matches nothing, and returns nothing either way, so it cannot be used to learn who
     has an account. Idempotent. A user id, a made-up token, or another kind's token changes nothing (tested).
   - An earlier draft signed `(user id, kind)` with an HMAC and a shared secret, but the database function behind it took the bare id
     and anyone could call it directly through the REST API, so the signature protected nothing. A token the caller must already hold
     fixes that, and leaves no secret to keep in two places.
   - `/api/email/unsubscribe` needs no session: a GET changes nothing and sends a person to a confirm page (mail scanners open
     links); a POST calls the function as `anon` with the public key, no service key. A malformed token answers 400, any well-formed
     one answers the same. Unsubscribing works whatever the flag says. Tokens are kept until the account is deleted so an old
     email's link still answers.
7. **Switches.** Sending: repo variable `EMAIL_ALERTS=true`, plus `EMAIL_FROM`, secrets `RESEND_API_KEY` and `EMAIL_DB_PASSWORD`. Missing any, the job sends nothing and its run summary names what is missing. The site's opt-in block:
   server env `EMAIL_ALERTS=on` (with `FAN_SIGNIN=on`).
8. **Logs.** Counts only. Resend's answer is reduced to a class of outcome and never printed (its error text can quote the address);
   a database or network error prints its code only.
9. **Account deletion** removes the opt-ins and the sent records by `on delete cascade` from `profile`; `delete_my_account` is unchanged.

## Retention
Opt-ins live until turned off or the account is deleted. `email_sent` keeps one small row per email until the account is deleted;
`email_game_event` keeps public game facts, a few thousand rows a season. Nothing prunes either; revisit if they pass 100,000 rows.

## Consequences
- The owner creates the Resend account, verifies the sending domain, makes the API key, the secrets and the database role
  password (`docs/email-alerts.md`); nothing sends before.
- `/privacy` should say addresses go to the email service for alerts the fan turned on, and for adults only; it is another
  change's file.
- Bounces and spam complaints are not read back (no webhook); one-click unsubscribe is the complaint path. A bounce webhook is a
  later round.
- Tests: `packages/db/test/email-alerts.test.mjs` (who gets which alert, rights, cascade), `tools/email/*.test.mjs`,
  `apps/web/scripts/email-unsubscribe.test.mjs` (the link's shape), `apps/web/e2e/email-alerts.spec.ts`.
