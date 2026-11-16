# ADR 0072: Other names and lineage on every program page, each from a cited public record

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It fills in ADR 0003 (school, program,
program_lineage) for plan Phase 1 item 3 ("Each program page lists its other names with sources") and keeps ADR 0010 (no
page names a source) as it is.

## Context
- ADR 0003 stores mergers and renames as `program_lineage` (many to many) and a school's names as aliases, but says
  nothing on whether a former school's history counts toward the program it became, or what a partial merger is.
- Before this, `data/seed/lineage/programs.csv` held 3 rows and five program pages had an Other names list (three merged
  schools, three UIL spellings). The code already counted every lineage predecessor's State Championships toward its
  successor.
- Measured Nov 15, 2026 against the repo's seasons (UIL state finals 1972 to 2025, game and playoff files 2018 to 2026,
  the 2026 brackets; the 1941 to 1971 no-final file names no schools): 280 current programs, 349 distinct team names, every
  current program in at least one season. 66 names reach no current program: 14 are bracket
  placeholders ("winner:NR1"), 3 are UIL finalists still independent but out of six-man (Christoval, Jarrell, Marathon),
  and 49 are private-league playoff teams of 2018 to 2025 that are not in a 2026 list.
- TEA's list (Consolidations, Annexations, and Name Changes ... Through School Year 2024-2025) has about 65 rows since
  1983. Eleven schools on it reach a current six-man program; the rest went to 11-man or 8-man districts, with no page
  here.

## Decision
1. **Sources.** Every row cites a public record that states the fact outright: TEA's list first, then UIL's own archive,
   then the school's or district's own site. No row from a guess, a look-alike name, or a fan or results site; a name with
   no such source stays out and is counted (below). The sources stay in the data (`source_url`), never on a page (ADR 0010):
   "with sources" in the backlog's done line is met by the data.
2. **Two hand files**, one cited source a row, checked by `check-data`:
   - `data/seed/lineage/programs.csv`: one program became or joined another. Events: `rename` (the same district under a
     new name, TEA "Name change" or a consolidation that kept the receiving CDN), `consolidation`, `annexation` (TEA's word,
     migration 0028), `split` (a district divided among more than one district), `coop`.
   - `data/seed/lineage/names.csv`: other names of the same school that are no lineage event: an older spelling a source
     uses (`spelling`) or a former name (`former`, with its last season when the source says it).
   - UIL's own spellings in its finals archive stay in `tools/history/uil-aliases.json` (the finals importer uses them).
3. **Checks** (`checkLineage` in `apps/web/scripts/check-data.mjs`, every CI run and robot run): each lineage row ends at a
   current program, never at itself, once per pair, and the rows have no cycle; a predecessor still in a current alignment
   may only be in a co-op or a split; each name belongs to a current program and is no current program's own name; every
   source is `https`.
4. **History.** ADR 0003 is silent, so: a predecessor's State Championships count toward its successor (title count,
   program page, the championships page's "now" link) **only for a rename or a consolidation into one program**. A
   school annexed by a district, or split among several, is listed under its successor, but its finals stay under its own
   name: an absorbed school is not the receiving program, and a split's history belongs to none of its successors. Season
   records (2018 on) are never moved: every game row is already under the name the program has today.
5. **The page.** A program page's Other names section has up to three lists: **Formed from** (each school with its event and
   season, and the seasons it played a State Championship), **Became** (for a program that still has a page), and **Also
   known as** (UIL spellings, names.csv, and spellings a program merge folded in). A name links when its program has a
   page. Theme tokens only (ADR 0035): `bg-panel`, `border-line`, `text-muted`, `text-navy`.
6. **Closed schools.** A closed school appears under the program it became; it gets no page of its own. Schools that
   played six-man here but are now out of it with no successor (UIL's Christoval, Jarrell and Marathon, and past
   private-league playoff teams) get no lineage row, since none exists; whether former programs get pages is a product
   call left open (plan cut-first rule 2).

## Consequences
- Programs with an Other names list: 5 before, 16 after. Lineage rows: 3 before, 18 after (TEA 14, Three Way ISD's own page 3, and
  Knox City's existing row from a newspaper repost). Other names in `names.csv`: 2 (TEA's "Welman", and
  "Spring Lake", Springlake-Earth's name through 1965 on its own history page).
- Left out for want of an allowed source, Nov 15, 2026: mergers that only secondary pages state for 15 current programs
  (Gilmer Union Hill, Lenorah Grady, Turkey Valley, Roscoe Highland, Matador Motley County, Cotton Center, Rochelle, Lohn,
  Kress, Guthrie, Loop, Paint Rock, Moran, Westbrook, Ladonia Fannindel), and Haskell Paint Creek's (its page gives a
  span of years, not one). Of the 49 past private-league teams, no school site states a rename or merger; two say they
  closed (no successor, so no row); the rest are open schools that left six-man, or not found.
- Names left out for want of a source are listed in the pull request and in `docs/context/PROJECT_STATE.md`.
- The database loads `programs.csv` as before (`packages/db/lineage.mjs`, which now accepts `annexation`); `names.csv` is
  read by the site only for now. When the admin console needs school aliases, load it into `school_alias`.
- A TEA row into an 11-man district (Goree to Munday, Novice to Coleman, Higgins to Canadian, and others) waits until that
  district fields six-man.
