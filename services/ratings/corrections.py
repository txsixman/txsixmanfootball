"""data/corrections/*.csv (written by the admin console) applied to the game rows the ratings read.

TWIN of apps/web/lib/corrections.ts (the pages' side): change one, change the other. The file formats are checked by
apps/web/lib/data-schemas.ts (CI runs scripts/check-data.mjs); this reads them trusting that, and a missing file is
simply no corrections.

  merge   a name some game file spells that no alignment lists -> the listed program it is. Applied first, to every team
          name in every game row (and in the game corrections' own names).
  game    one row per game, the LAST row for a game winning: `score` and `forfeit` set the score, `void` drops the game.
          A forfeit row carries the way results record one (1-0 or 2-0), which rows.py already reads as a forfeit.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

CORRECTIONS_DIR = Path(__file__).resolve().parents[2] / "data" / "corrections"


@dataclass(frozen=True)
class GameFix:
    home: str
    away: str
    action: str  # score | forfeit | void
    home_score: int
    away_score: int


@dataclass(frozen=True)
class Corrections:
    merges: dict[str, str] = field(default_factory=dict)
    games: dict[tuple[str, frozenset[str]], GameFix] = field(default_factory=dict)

    def name(self, team: str) -> str:
        return self.merges.get(team, team)


def _rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with open(path, newline="") as f:
        # QUOTE_NONE: the files hold no quoted cells (the site refuses to write one), so a stray double quote is plain text and
        # never swallows the rows below it.
        return list(csv.DictReader(f, quoting=csv.QUOTE_NONE))


def load_corrections(directory: Path | None = None) -> Corrections:
    directory = directory or CORRECTIONS_DIR
    merges = {r["name"]: r["same_as"] for r in _rows(directory / "programs.csv")}
    for name, target in merges.items():
        if target in merges:
            raise ValueError(f"merge {name} -> {target}: {target} is itself merged into {merges[target]}")
    games = {}
    for r in _rows(directory / "games.csv"):
        home, away = merges.get(r["home"], r["home"]), merges.get(r["away"], r["away"])
        void = r["action"] == "void"
        fix = GameFix(home, away, r["action"], 0 if void else int(r["home_score"]), 0 if void else int(r["away_score"]))
        games[(r["game_date"], frozenset((home, away)))] = fix
    return Corrections(merges, games)


def apply_to_game(
    c: Corrections, date: str, home: str, away: str, home_score: int, away_score: int, end_reason: str
) -> tuple[str, str, int, int, str] | None:
    """One game with the corrections applied, as (home, away, home_score, away_score, end_reason); None if voided."""
    home, away = c.name(home), c.name(away)
    fix = c.games.get((date, frozenset((home, away))))
    if fix is None:
        return home, away, home_score, away_score, end_reason
    if fix.action == "void":
        return None
    hs, as_ = (fix.away_score, fix.home_score) if fix.home != home else (fix.home_score, fix.away_score)
    return home, away, hs, as_, "forfeit" if fix.action == "forfeit" else "unknown"
