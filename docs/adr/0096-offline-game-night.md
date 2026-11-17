# ADR 0096: Offline game night: a saved copy that says so, saved ahead, installable

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It extends the service worker ADR 0001 and ADR 0080
describe (one worker, `sw.ts`; no second one) and the push worker code in the same file (ADR 0054, 0082). Nothing about what a
page says changes while the phone is online; live scores, "Unconfirmed, no leader" (ADR 0021, 0039, 0043, 0044, 0087) and every
polling interval are as they were.

## Context
- Six-man games are played in small towns where a phone often has one bar or none. The worker already kept pages, but:
  - a saved page was used for **30 minutes** at most, so a page opened an hour earlier came back as "Offline" at the field;
  - the only sign of a saved page was "You are offline. These are saved pages; scores may be out of date.", which did not say
    **which** page was old or how old, and which appeared above the page and moved it;
  - a saved page still drew what it knew as if it were now: the red "Live" band and section of a game that was on when the page
    was saved, "In progress" worked out from the phone's clock at the moment of viewing, and "Checked every few minutes";
  - the "My teams" files were not kept, so that block was empty offline; and the manifest opened the site on `/`, with one icon.
- The one rule that stays above all others: **never show a stale score as current.**

## Decision
**What is kept, and for how long** (`lib/sw-rules.ts` holds every rule; the worker and the tests share it):
- Pages a fan opened are **network first with a 3 second wait**, then the saved copy: documents (`saved-pages`), the data Next
  fetches for a followed link (`saved-data`) and the followed teams' small files (`saved-my-teams`). Each cache keeps **60** entries,
  the least recently saved or used going first. Pages with nothing that changes in a season (`/championships`, how the rankings
  work, search, the offline page) are kept a week, 30 entries.
- A saved page is **stamped with the time it was saved** (a header on the stored copy) and is used for **12 hours**, a whole game
  night and the morning after (was 30 minutes). Past that, or with no stamp, it is no copy and the offline page comes. Only a plain,
  public 200 is stored (no opaque answers, nothing marked `no-store` or `private`).
- **Never cached**: `/admin`, `/auth`, `/sign-in`, `/account`, `/forums` (`lib/never-cached.ts`, as before), every `/api` and
  `/_vercel` address and every other site. Ahead-of-time saving (below) accepts only score, program, playoff and championship paths with
  no query, so it cannot be asked to keep anything else.
- **Static files** are cache first, in a cache **named for the build** (`static-<commit>`), beside the precache of the build's scripts
  and styles. When a new worker activates it **deletes** every cache it no longer writes: the old page caches and each earlier
  build's static files. Logos and the search index keep their caches across builds.

**A saved copy says so, in a bar that moves nothing** (`app/offline-notice.tsx`):
- The page asks the worker whether what it is showing came from the cache (the worker notes it as it answers, per page and per
  followed link). If so, a bar **fixed to the foot of the screen, 56 px high** (it takes no room from the page; a spacer at the end of
  the page keeps the footer's links reachable) reads **"Saved copy from 7:42 PM. You're offline; scores may have changed."** The time
  is when the copy was saved, **Central time**, with the weekday when it was another day. On a weak signal (the copy was shown because the
  page was slow, and the phone thinks it is online) it says "Weak signal" in place of "You're offline".
- A saved copy **shows no live score and asks for none** (`lib/saved-copy-state.ts`): the live read (`useLiveScores`) and "Scores
  checked" do not run while the page is a saved copy or the phone is offline, and start again on a fresh page. The page's clock is
  **frozen at the time it was saved**, so a game saved before kickoff does not read "In progress" at 9 PM, and a game saved under way
  reads "Under way when saved". The red Live band, the "Live now" section and the scoreboard's Live cell turn blue and say "Saved copy",
  "Under way when saved" or "Saved"; the "Checked every few minutes" line says "No score when this copy was saved."
- A fresh page whose phone loses its signal gets a shorter bar ("You're offline. Scores on this page may have changed.").
- **Retry:** when the signal returns (the `online` event), every 20 seconds while the page is visible, and on a **"Try again"** button
  (44 px or more), the page asks the network for the tiny manifest. If it answers, the page **loads again** (never while a field is being
  typed in, and not more than once a minute on its own, so a flaky signal cannot reload it in a loop). If the network is still slow the
  worker serves the saved copy again, and the notice stays, because it is asked again on every load. A fresh page loaded this way
  shows **"Back online — updated"** for six seconds in the same bar. Reload, not an in-place refresh, so "updated" is never said of a
  page that came from the cache.

**Saving ahead** (`lib/save-tonight.ts`, the worker's `save` message):
- On a **followed team's game day** (a followed team's next game is on tonight's game night, `lib/game-night.ts`), "My teams" saves
  `/scores`, `/scores/tonight`, `/playoffs/this-round` (this round's bracket) and the **game page of each followed team's game tonight**
  (at most 12 pages), once, two and a half seconds after the list stops growing, and not again for the same set within 20 minutes. A line
  in the block says what it kept and what that cost: "Saved for tonight: 4 pages, 640 KB on this phone, so they open with no signal."
  The line holds its height from the first paint.
- `/scores/tonight` has a **"Save for no signal"** button that does the same on request, for a fan who follows no one.
- **Cost** (sizes as stored; the download is about a ninth of that, compressed; from ADR 0080's measurements, to be confirmed by
  the first game night's numbers in the line above): `/scores` 276 KB, this round's bracket 189 KB, a game page 61 KB, Tonight not yet
  measured (assumed near the scoreboard's). About **0.6 to 0.9 MB stored and about 70 to 100 KB downloaded** for the board, the bracket and two or three
  games. Nothing is saved until a fan follows a team and visits on a game day, or taps the button. The 60-page cap bounds everything.

**Installable** (`app/manifest.ts`): `id` and `start_url` **`/scores`** (the page wanted on a game night), `scope /`, `display
standalone`, `orientation portrait`, theme `#0a2a5e`, background white, and icons at **192** and **512** (any) and a **512 maskable**
(`/pwa-icon/192`, `/pwa-icon/maskable`, drawn from the same mark) beside the Apple icon, plus two shortcuts (Tonight, Playoffs). The
worker keeps `/scores` once a fan has opened it, so the installed app opens offline.

## Alternatives not taken
- **Stale-while-revalidate for pages:** shows the old page first and swaps, so a score changes under the reader's eyes with no
  notice; network first with a labeled saved copy is the honest version.
- **Reading the saved time from the page's own response headers:** a page cannot read its own navigation response. The worker
  answers a message instead, and, if it was restarted and forgot, reads the stamp on the cached copy.
- **Refreshing the page in place when the signal returns** (`router.refresh()`): if the worker served the saved copy again the page
  would say "updated" while showing old data. A reload shows the notice the truth.
- **Precaching whole pages at install:** every deploy would download them for everyone, and they would carry no save time.

## Consequences
- A page can be up to 12 hours old when shown offline, and it says exactly when it was saved; the 30-minute rule is gone.
- The live bar and badges never appear on a saved copy. If a game was on when a page was saved, the copy shows what was true then,
  labeled, and the fan taps "Try again" or waits for the signal.
- `sw.ts` is built with the commit as `__SW_REVISION`; the unit tests (`scripts/sw-rules.test.mjs`, `saved-copy.test.mjs`,
  `build-sw.test.mjs`) pin the routing rules, the cap, the age, the cache cleanup and the notice words, and `e2e/offline.spec.ts`
  (CI's production build) visits, goes offline, reloads and reads the notice, checks there is no live line, then returns online.
- Not covered by a test: the notice on a followed link opened offline without a reload (the worker notes it per link; the e2e
  reloads). Not built: background sync and a push that says a saved page changed, which are larger than this round.
- The worker's own code runs only in a browser, so CI's end-to-end test is the first run of the new worker; the node tests cover
  its rules, not Serwist's handlers.
