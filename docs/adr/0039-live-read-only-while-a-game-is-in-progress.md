# ADR 0039: Tonight in groups by the clock, and the live read only while a game is in progress

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Narrows how often ADR 0021's browser read runs
and uses ADR 0036's kickoff status for it; every other rule of ADRs 0004, 0009, 0010 and 0021 stands.

## Decision
- **Tonight is grouped by the clock** (`groupTonight` in `lib/kickoff.ts`), one organization at a time (ADR 0012), in the
  browser at the moment of viewing, so the static page re-sorts as the clock moves:
  - "In progress", earliest kickoff first; "Up next", earliest first, a game with no time listed last; "Final", latest first,
    a game with no time last. An empty group is not shown.
  - A game with a final or a forfeit is Final whatever the clock says. A game with no final more than 4 hours past kickoff
    (or a game with no time listed, after its day) is not Final: it goes last, under "Score not reported yet", latest
    kickoff first.
  - The server's HTML, and the first render in the browser, put every game with no final under "Up next", so nothing
    differs between them; the groups move once the page runs.
- **The live read runs only while a game on the page is in progress** by `kickoffState`, checked again every minute. It
  starts by itself at kickoff and stops when the 4-hour window ends. On a game page that means that game's window. A game
  with a final never starts it. A game with no kickoff time is never "in progress", so it does not start it either: when no
  time is known the page asks for nothing. Still true: no request while the tab is hidden, the request is aborted when the
  page is left, and a failed request shows nothing.

## Consequences
- A page opened before the first kickoff, after the last window, or on a night of finals sends no request to Supabase.
- A game whose kickoff is missing from the facts file shows no live line until its time is added, even if the reader has a
  live row for it. The kickoff file is the switch.
