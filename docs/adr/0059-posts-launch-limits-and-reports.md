# ADR 0059: Posts launch: a per-minute limit, no gambling talk, Report for every viewer, first posts not held

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It extends ADR 0018 (fan posts, moderated by
code) and changes none of it. Posts stay closed until the owner opens both switches (ADR 0052).

## Context
Before posts open to the public, ADR 0018's rules were checked against a launch list: rate limits per account by the minute
and the day, blocked words and links, report-a-post from any viewer, a new account's first posts held or limited harder, and no
betting words in what fans write. Three gaps were found:
- The limits were per 10 minutes and per 24 hours. An established account could post 8 times in its first few seconds.
- Nothing stopped a fan writing betting words, which the site itself never uses (CLAUDE.md, "Betting"), on its own pages.
- Report (then called Flag) showed only to a signed-in fan with a finished profile. A visitor saw nothing to press.

## Decision
- **Per minute, as well.** Every write (comments, replies, edits, threads, reports of posts, score reports) is also limited per
  minute, a new account (under 7 days) more tightly: posts 2 a minute (4 established), threads 1 (2), reports of posts 3 (5),
  score reports 2 (3). The 10-minute and 24-hour limits are unchanged. In the database (`fan_rate_check`, migration 0027), so
  no route can skip it.
- **No gambling talk in posts.** A post or title that holds a gambling term as a whole word or phrase (odds, point spread,
  parlay, wager, sportsbook and the rest of `wordlist.json`'s `betting` list) is refused like a slur, with its own answer, in the
  site and again in the database (`moderation_betting`, the shared vectors). Common football words are left out on purpose:
  "bet" alone ("I bet we win"), "spread" ("spread offense"), "line" and "pick" ("offensive line", "pick six"). The page text
  that explains the rule says "gambling talk", so no page uses the words themselves.
- **Report for every viewer.** Each post that is not your own shows Report. Signed in with a profile it reports the post at
  once. Signed out it is a link to sign in that comes back to the same page; signed in without a finished profile, a link to
  finish it. Nothing is sent for a visitor without an account: an anonymous report would be a free way to bury posts.
  "Flag" is renamed "Report" on the page; the database names stay.
- **A new account's first posts are not held for review.** ADR 0018 says nothing waits on the owner, and holding posts would
  make him a reviewer. New accounts stay limited harder instead: no links, the tighter limits above, and their reports of posts
  do not count toward hiding (each one still reaches the owner's list, ADR 0060).

## Consequences
- A word list misses spellings it was not told about (spaced-out letters, made-up slang). The owner can hide what gets past it
  (ADR 0060); a second check is still for later (ADR 0018).
- A fan may be refused for a fair use of a listed word ("against all odds"). The answer says why, and the fan can reword.
- The tests that posted in bursts move their earlier rows back a minute (`cool()` in `packages/db/test/posts-helpers.mjs`).
