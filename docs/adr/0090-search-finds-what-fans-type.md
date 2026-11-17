# ADR 0090: Search finds what fans type, as they type it

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It changes how /search finds and ranks, and where
"Find your team" lands; it adds no page and changes no other page's words.

## Context
- /search was Pagefind's full-text search over the built program and results-week pages. A fan who typed "White Face", a
  mascot, "CHANT" or "FWC" got nothing or noise, and a program page came up for any school it mentioned as an opponent. There
  was no ranking beyond the words' frequency, nothing told two schools of one name apart, and "Find your team" on /welcome
  (ADR 0086) went to the Programs list, a plain-substring filter, not to a search.
- A check of what fans type, run against the real data (283 programs, 218 mascots, 2,500 series pages, nine seasons), found these
  failing: a space in a one-word name ("White Face"), a swapped or missing letter, a mascot, an abbreviation (initials; a
  school's own tag in brackets), a school's other name (a spelling or a former name), "Saint" or "Fort" for "St" or "Ft",
  "ISD", "Academy" or "Christian" said or left off, two teams ("jayton whiteface") and a year ("2024 jayton").

## Decision
- **The index is made at build time and travels with the page.** `lib/find-index.ts` (read when the site is built, from the same
  loaders the pages use) writes one entry a program: its name, mascot, league lines and place, other names (the lineage files'
  spellings and former names), the seasons it has a page for and its crest, plus one bit for every pair of programs that has a
  series page, the seasons with a season page and the years with a State Championship page. **53,300 bytes of JSON, 8,579
  brotli, for 283 programs** (the props this page sent before: 111,223 and 10,845). The size is a test (60,000 and 12,000).
  Nothing is fetched while someone types, so there is nothing to wait for and nothing to shift.
- **The matching is plain code in `lib/find.ts`, with no imports of its own beyond two pure files**, so the browser, the build
  and the tests run the same thing:
  - Words are lowercase, without accents or apostrophes; "ft", "mt", "st" are Fort, Mount, Saint; a plural's "s" is dropped
    ("Jaybirds"). Each word typed must match something of the program: a word of its name, its town (the name after the hyphen),
    another name, its mascot, its league, or an abbreviation (initials of its name, "(CHANT)", town-then-school initials for
    a hyphenated TAPPS name: FWC is Covenant Classical-Fort Worth). Matches count as whole word, start of a word, inside a
    word (4 letters or more) or a misspelling (one letter wrong or swapped at 4 to 6 letters, two at 7 or more).
  - **Exact and start-of-name hits rank first**, then a word's start, then inside, then a guess. A guess is shown only when
    nothing matched as typed. The whole name said exactly beats everything; a name that starts with what was typed beats one
    that only contains it; a shorter name beats a longer one on a tie.
  - "ISD", "School", "Academy", "Christian" and a few like them are soft: said, they lift a school that has them; left off or
    wrong, they do not exclude. Two words typed apart that are one name ("white face") are tried run together too.
  - **Two teams are a game** ("jayton whiteface", "jayton vs whiteface", "whitharral at earth springlake"): it opens their series
    page when they have one, else the Matchup page for the pair, with both teams under it. This is offered first when the words
    are split by "vs" and otherwise only when no single team fits every word, so "grayson christian" stays a team.
  - **A year with a team is that team's season** ("2024 jayton"); a year alone is that season and that year's State
    Championships, where they have pages. Only years with a page are offered.
  - A league name lists its programs, cut to 20 with the count said ("Showing the first 20 of 158 programs").
- **Every result says what tells it apart:** the town (TAPPS names carry it), the mascot, and each league's division, region and
  district ("Jaybirds · UIL Division I · Region 1 · District 4"; a school in two leagues names both). A test fails if two entries
  read alike.
- **Weeks of results are still Pagefind's.** It loads only when someone searches, and now only adds the weeks (never a program
  page, which the index above finds by name), under their own heading. It is a second step: the teams are on screen first.
- **The box:** the cursor is in it on a plain visit (a shared `?q=` link does not raise a phone's keyboard); results appear as
  each letter is typed; the address follows the search (replaceState), so Back and a shared link keep it; Enter opens the best
  match; Down enters the list, Up and Down walk it, Up from the first (or Escape) returns to the box, Escape in the box clears
  it. The count is a polite live region; the keys are in text for a screen reader (`aria-describedby`). Targets are 44 px.
- **Nothing found says what to try** (a town, a mascot, first letters, two teams, a year with a team), offers the nearest name
  ("Did you mean Whiteface?", up to a third of its letters wrong) as a button that runs that search, and links to Programs.
- **"Find your team" on /welcome opens /search** (both buttons, and the "Open Search" step), where the cursor is already in the
  box. The Programs list stays as the page to browse by league and district.
- **Held to ADRs 0080 and 0081 and PR 161:** `/search` joins Lighthouse's pages (the same budgets); the shared-link layout-shift test
  (under 0.1) now covers five kinds of search, including a 20-row list and the empty state; `e2e/search.spec.ts` runs axe with
  best-practice rules, 44 px targets and no sideways scroll; links' names hold the text they show.

## Consequences
- The table in `scripts/find.test.mjs` (about 50 real queries and the first result each opens) is the contract. A new kind of
  query that fails gets a row there before the fix. It also checks every program finds itself by its full name, in capitals and
  as its address, and that every series page is a set bit.
- The index grows with programs, not with games: a program is about 190 bytes, 30 bytes brotli. 1,000 programs would be about
  190 KB; at that size it should become a file fetched on first focus.
- A new program, mascot, spelling or season shows in search at the next build with no search change. A new league needs nothing
  here; a new kind of page (a district, a week) needs an entry in `lib/find.ts`'s answer.
- /search has no page-level index fetch, so it works offline once loaded. Weeks of results do not.
