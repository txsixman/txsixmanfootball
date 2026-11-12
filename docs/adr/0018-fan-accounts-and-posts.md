# ADR 0018: Fan accounts, posts and fan score reports, moderated by code

**Status:** Accepted Nov 12, 2026 (the owner, through the master session). Supersedes two parts of earlier ADRs, and only
those: ADR 0014's "no user posts" and "no accounts or personal data for minors", and ADR 0011's "three or more
agreeing sources confirm a score" for fan score reports. Every other rule of ADRs 0011 and 0014 stands.

## Context
ADR 0014 cut fan submissions and accounts: the owner builds alone and will not moderate. The owner now wants fans to sign in,
follow teams, post in forums, comment on game pages and report scores, with no manual review ("I don't want to do any
work"). The audience is high school football, so many fans are 13 to 17.

## Decision
- **Sign-in:** Supabase Auth, email link or Google. No passwords. One shared sign-in for fans and the admin console;
  the console stays the owner's alone (his user id on the server and `is_admin()` in row-level security), whatever the
  sign-up setting.
- **Age:** 13 and up. Sign-up asks the birth year only; under 13 is refused and nothing about the person is stored.
  No parental tools (see Accepted risk).
- **Minors' data kept to a minimum:** birth year only, never a full birth date; a display name, never a public real
  name; no age or school field; no direct messages; no minor's data sent to any third party; any user can delete
  their own account. Players are still never named or ranked by the site itself.
- **What signed-in fans can do:** follow teams (a My teams page; following without an account keeps working in the
  browser), post in forums, comment on game pages, report scores.
- **No uploads:** no pictures or files from fans, ever. Accounts older than 7 days may post plain links, shown as text
  links, never embedded or previewed.
- **Moderation runs itself, with no queue:**
  - Slurs and threats are blocked in code from an open word list, before a post is saved.
  - Accounts under 7 days old: no links, and tighter rate limits. Every account is rate-limited.
  - A post flagged by 3 different accounts (each older than 7 days and not muted) is hidden automatically.
  - An account with 3 hidden posts in 30 days is muted automatically.
  - Edits keep every earlier version (no silent rewrites).
  - The owner may unhide, unmute or ban from `/admin`, but nothing waits on him.
  - No paid or third-party AI moderation for now.
- **Fan score reports:** never shown on their own. A fan-reported score shows once two different accounts, each older
  than 7 days, agree, or once it matches the Results watch's read. Until then no winner is named (ADR 0004). A score
  that matches still follows ADR 0013 for records and standings.
- **Every new table has row-level security**, every write is checked on the server, and logs carry no emails, birth
  years or tokens.

## Accepted risk (the owner's)
Accounts for 13 to 17 year olds bring the Texas SCOPE Act (HB 18) into play: registering age at sign-up, limits on
minors' data, and parental supervision tools. Courts have blocked parts of the act; the parental-tools duty was not
challenged, and the full Fifth Circuit granted rehearing on Oct 28, 2026, so the law is still moving. The owner was told
this and chose 13+ without parental tools, accepting the risk, with no attorney review (ADR 0014). Fans' posts also
need a registered DMCA agent for safe harbor; the owner registers it himself.

## Consequences
- The auth foundation and the admin console come first, then accounts and following, score reports, game comments
  and forums, each round with its own security review.
- `CLAUDE.md`'s minors rule changes from "no birth dates" to "birth year only, never shown".
- A word list misses a lot. If abuse gets past it, the next step is a second check, decided then.
- A privacy page and terms covering posts ship with the accounts round.
