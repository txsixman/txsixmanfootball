# ADR 0055: The weekly team digest

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. Builds on ADR 0053 (email alerts) and ADR 0056 (18 or older
by birth year). The postal address in its footer is required, by the owner's decision of 2026-11-15 (point 6).

## Context
- ADR 0053 built the opt-in, the unsubscribe, the sender role and the switches for more than one kind of email: `email_kind` already has
  `weekly_digest`, and `email_optin`, `email_sent`, `email_unsubscribe_token`, `email_set_optins`, `email_my_settings` and
  `email_unsubscribe` do not care which kind they hold.
- The owner wants a Monday email that tells a fan how the teams they follow are doing: last week's result, how the team moved in the
  rankings, and its next game with the chance to win the site already shows.
- The same rules bind it as the alerts: opt-in, never on by default; adults only (ADR 0056); no source named; no betting words; no
  address in any log; nothing broader than the least-privilege `email_sender` role.

## Decision
1. **Opt-in on `/account`.** A "Weekly digest" box under the Email alerts block, with its own save: ticked it calls
   `email_set_optins('weekly_digest', '{*}')` (every team the fan follows, those followed later too), unticked it turns it off. It
   shows under the same server switch as the alerts (`EMAIL_ALERTS=on`) and under the same eligibility: the database refuses an
   account that is not an adult (`email_adult`, 18 or older by birth year, ADR 0056) or is banned. Nothing is on until saved. A fan
   has one unsubscribe token for the digest (made at their first digest opt-in), separate from the alerts' token, so a digest link
   turns the digest off and nothing else.
2. **What a fan gets, per followed team** (a team's section is the same for everyone who follows it):
   - *Last week* (Monday to Sunday before the send): the confirmed final, away team first, as the alerts show it. Never a 0-0, a
     forfeit or a disputed game; those read "No confirmed result yet" when a game was listed, and "No game last week" when none was.
   - *Ranking*: its place in its group now and the places moved since a week earlier ("#4 in Division I, up 2 places from #6"). The
     group, the rank and the move are the rankings pages': a UIL six-man division, else the organization (ADR 0012); no rank under
     four rated games; a move shows only when the rating itself moved by more than 4 points ("about the same as last week" otherwise);
     "new in the rankings" for a team unrated a week ago. Left out when the ratings have no column for that week.
   - *Next game*: the earliest listed game from the send day on, with its day and kickoff when known and each side's chance to win
     ("Chance to win: Beta 31%, Alpha 69%"); or, when the bracket has set it but no site lists it, the round and the teams with "Date to
     be listed" (ADR 0047). "No game scheduled" when none. The words are "chance to win" only, never a betting word. No source is named.
   - A team with a long list is cut at 25, with a note that the rest are on the account page.
3. **Off season.** A fan none of whose teams has a confirmed result last week or a next game is sent nothing that week, and nothing is
   recorded for them (a ranking alone is not news).
4. **The site's rules, copied once.** The job runs under plain Node, which cannot load `lib/*.ts` (they import each other without file
   extensions). The rank, the ranking move and the chance to win are therefore small copies in `tools/email/digest-data.mjs` of
   `lib/rank-range.ts`, `lib/ratings.ts` `movement` and `lib/projection.ts`. `apps/web/scripts/email-digest-parity.test.mjs` runs the
   site's own code and the copy on the real season for every team and every week and fails if they disagree. A school that two leagues
   list is counted in the first league that lists it.
5. **Sending and dedupe.** A scheduled workflow, `email-digest.yml`: Mondays 7:30 AM Central (13:30 UTC), gated by the repo variable
   `LIVE` as the other weekly jobs are (GitHub's `schedule` has not been reliable here, ADR 0024), plus `workflow_dispatch` whose
   `dry_run` (the default) sends and records nothing and prints counts. It sends only when the repo variable `EMAIL_DIGEST` is `true`
   AND `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_DB_PASSWORD` are set; otherwise the summary says what is missing. A real send is
   allowed Monday to Wednesday (Central) only, so a late or repeated run still sends the right "last week" and a stale one does not.
   Each digest is recorded in `email_sent` as `(user, 'weekly_digest', '<ISO week>')` through `email_mark_sent`, which the sender
   already runs; the week's Resend `Idempotency-Key` is a hash of the same three. A refusal for good is recorded `rejected`; 5xx or a
   timeout is retried by the next run in the window; 429, 401 or 403 stops the run (401 and 403 fail it). Logs are counts only.
6. **The postal address is required (the owner's decision, 2026-11-15).** Every digest ends with the address from the repo variable
   `EMAIL_POSTAL_ADDRESS` (up to five short lines, no markup), after the "why you got this" sentence and the Unsubscribe link. While it
   is empty, unset, or not an address a footer can hold, the digest REFUSES to send: the job prints and fails with the count of digests
   it refused, and sends nothing. The address is never committed and never printed. Game alerts do not carry it.
   The owner should use an address that is not his home (a PO box or a mail service).
7. **The database.** Migration 0025 adds one function, `email_pending_digests(p_week, p_limit)`, and grants it to `email_sender`
   alone, which brings that role to four functions, none of them a table right: for a week like `2026-w47`, one row per opted-in adult
   with a confirmed address who is not banned and not already recorded for that week, with the teams of theirs the digest covers (all
   they follow for `*`, else the ones they ticked that they still follow), their address and their digest unsubscribe token. It
   refuses a week that is not `YYYY-wNN`. Supabase's API roles cannot run it.

## Retention
One `email_sent` row per fan per week sent, about 15 a season each; kept until the account is deleted, as ADR 0053's. Account
deletion removes the opt-in, token and records by `on delete cascade`.

## Consequences
- The owner sets the repo variables `EMAIL_DIGEST` and `EMAIL_POSTAL_ADDRESS` (`docs/email-alerts.md`); nothing sends before.
- `/privacy` should say the weekly digest also sends the address to the email service (the same sentence as the alerts').
- The digest says nothing about a game that has no confirmed result, by design; a week with a disputed or forfeited game shows
  "No confirmed result yet" rather than a guess.
- Tests: `tools/email/digest-*.test.mjs` and `send-weekly-digest.test.mjs` (the facts, the words, the refusal), `packages/db/test/email-digest.test.mjs`
  (opt-in, who is due, once a week, the token, rights), `apps/web/scripts/email-digest-parity.test.mjs`, `apps/web/e2e/email-alerts.spec.ts`.
