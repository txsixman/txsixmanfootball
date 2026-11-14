# ADR 0048: Standings by District, Area and Region

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It changes how /standings groups its tables,
not how a record is counted (lib/standings.ts is unchanged).

## Context
- /standings listed one table per district. A fan following the playoffs also wants the teams grouped the way the bracket
  meets them: the two districts that cross over in bi-district, and the region.
- UIL's 2026-28 alignment PDFs pair districts 2k-1 and 2k in bi-district (1 and 2 play W1 v R2 and W2 v R1, then 3 and 4,
  up to 15 and 16), in Division I and Division II alike. Each region holds four districts (Region 1 is districts 1 to 4).
- The owner chose that an **Area** is that district pair.

## Decision
1. **Three levels for UIL**, switched at the top of the page and kept in the URL (`?view=area`, `?view=region`; no
   `view` is District). Every level is in the page's HTML; the switcher shows one. A link to a district's table (`#d-…`)
   opens District.
   - **District:** the district tables as before, ordered by district record then overall, under their region and area
     headings ("Region 1 · Area 1 (Districts 1–2) · District 1").
   - **Area** and **Region:** every team in it in one table, ranked by overall win percentage, then point difference,
     with a District column. The page says the rule in one line. League tiebreakers are not applied.
2. **The pair rule is one function** (`lib/standings-levels.ts` `areaPair`), tested against the 2026-28 pairs and the
   alignment file. A region is the alignment's own region column; areas are numbered within it.
3. **Only levels the alignment holds.** TAPPS and TCAF have districts and no regions: District only, no switcher. TAIAO
   has North and South regions and no districts: its region tables, no switcher. No level is made up.
4. **Phone first:** tables fit 375px without sideways scrolling, the region heading stays at the top while its tables
   scroll, and each level has links to jump to a region.
5. **No playoff seed column yet.** The data holds no seed or district finish (W, R, 3rd, 4th); it is added when a source
   for it is stored, never worked out from the bracket.

## Consequences
- `/standings/sample` shows the levels with invented schools, for whole-page screenshot baselines (the real tables change
  every game week).
