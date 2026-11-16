# ADR 0074: A UIL six-man school in no district is registered, with no standings place

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It follows ADR 0073 (the registry counts
what it is missing) and ADR 0048 (standings by district, area and region), and moves High Island out of "not yet
listed".

## Context
- UIL's 2026-28 alphabetical alignment (realignment.uiltexas.org, which has no robots.txt) lists High Island as 1A,
  football Division II, District 15, 6-Man. UIL's June 15 revision of the Division II alignment, which every other UIL
  row follows, puts High Island in no district (and drops Priddy and San Perlita, which played no 2026 game, while it
  adds Westhoff Academy).
- High Island plays six-man: eight 2026 games against listed programs, which the results robot skipped because no
  alignment held it.
- ADR 0073 left it "not yet listed" only because UIL's standings levels need every UIL district numbered.

## Decision
1. **Registered in UIL, Division II, district `Not in a district`, region blank**, cited to UIL's alphabetical list
   (its six-man and division facts). It is a UIL program: ranked with Division II, on the programs index under
   "Division II · Not in a district", with a program page.
2. **No standings place.** Standings take numbered districts only (`standingsFrom`, as for TCAF's "District not
   listed"), so its division keeps its district, area and region levels, and its games count toward its opponents'
   records. A blank region keeps it out of region title chances and bracket regions.
3. The data checks allow exactly this value for an unnumbered UIL district, with no region
   (`standings-levels.test.mjs`, `seed.test.mjs`), and `audit-data.spec.ts` checks the standings stay whole.

## Consequences
- 283 programs, every one with a source; not yet listed falls to 10 teams and the TCAL and TCSAAL league rows.
- If UIL places High Island in a district later, its row takes the number and region, and it gets a standings place.
