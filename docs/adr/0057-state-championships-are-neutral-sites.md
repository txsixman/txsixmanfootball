# ADR 0057: A State Championship is a neutral site; other playoff games keep the listed home team's edge

**Status:** Proposed Nov 14, 2026 (decisions D1 and D2 of `docs/audits/ratings-2026-11.md`, taken in pilot mode; the owner
may override); accepted when its pull request is merged.

## Context
- Robot-read playoff games (ADR 0008) name a listed home team and almost never a site. The ratings give that team
  `home_field × PLAYOFF_EDGE`, and `PLAYOFF_EDGE` is 1.0: the full home edge, about 4.6 points in 2026.
- 1.0 is a fit, not a field. The fitted share was 1.65 (SE 0.43), capped at 1, and it improved walk-forward log loss
  (0.3655 to 0.3621). The listed home team is usually the higher seed, so the edge probably measures seeding as much as
  the field. ADR 0041 found 14 of 17 known bracket sites were not the listed home team's town.
- Comments in `lib/brackets.ts`, `services/ratings/run.py` and four visible notes still called these games neutral.
- A State Championship is read two ways. Its game row on /scores and in the bracket gave the listed home team 4.6 points;
  its title chance gave none. The TCAF State Championship of Nov 14, 2026 showed Faustina Academy at 76% on its row and
  81% as its title chance.
- State Championships are played at neutral sites in every league.

## Decision
- **D1.** A State Championship (round `state` for UIL, `final` for the other leagues) is a true neutral site everywhere:
  no home edge in its game row, its projection, the title chances, the likely-next-pairing preview, and the ratings fit.
  A row whose `neutral` says `false` keeps the full edge; one that says `true` is neutral in any round. One rule, read
  the same way by `fieldOf` (`apps/web/lib/projection.ts`), `read_files` (`services/ratings/rows.py`) and
  `playoff_sites` (`services/ratings/run.py`).
- **D2.** Every other robot-read playoff game keeps `PLAYOFF_EDGE` 1.0 for the listed home team. Comments and visible
  notes say "the home edge for the listed home team", never "neutral site".
- **Next season (2027):** test a seeding term (the listed home team as higher seed) against `PLAYOFF_EDGE`, walk-forward,
  fitted on 2018 to 2026 and scored on 2027 playoff games only. Change the share only if that test wins out of sample.

## Consequences
- A State Championship's row and its title chance now agree. Final and last-four chances move by up to about 5 points
  where the listed home team was the weaker side or the stronger one.
- The ratings fit gives finals no edge, so every table from 2018 on was re-rated (`run.py --chain 2026`). Ratings moved
  by tenths of a point; the backtest was rerun on the new tables.
- Other playoff projections are unchanged. The listed home team's edge stays a measured fact about these games, said
  plainly, until a seeding test beats it.
