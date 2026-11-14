"""Reading game files into the rows the model fits: ONE rule for what counts as a rated game, used by the site's tables
(run.py) and by Gate G3's backtest (backtest.py), so the two can never disagree about a game.

A played game is one of:
  rated        in the fit and in the records
  forfeit      recorded 1-0 or 2-0 (what the robot writes for a forfeit) or end_reason "forfeit": in the records, never
               in the fit. TWIN of `forfeitScore` in apps/web/lib/games.ts: change one, change the other (a test runs
               the same robot-style scores through both rules' table, apps/web/scripts/forfeit-rule.test.mjs).
  no_contest   0-0: a game nobody played; in neither the fit nor the records' wins and losses (it is a tie on paper)
  duplicate    one game listed twice, dropped everywhere. THE RULE: the same two teams with the same score (each team's own
               score, so home and away swapped still counts) at most DUPLICATE_DAYS apart (the same day too). The earlier date
               stays, file order breaks a tie, and a row is judged only against rows that stayed. TWIN of `duplicateRows` in
               apps/web/lib/duplicate-game.ts, which the reader, the site's loaders and check-data use: change one, change the
               other (apps/web/lib/duplicate-cases.json is the table both are tested against, test_duplicates.py here).
A non-zero tie is kept (a real result) and counted in the report. A game against a school outside our alignments (read
from a season's outside.csv) is a rated game against a HIDDEN team: it informs the fit and is never shown in a table.
"""

import csv
import datetime as dt
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from corrections import Corrections, apply_to_game, load_corrections
from model import Games

DATA = Path(__file__).resolve().parents[2] / "data"
# The robot's own folders (maxpreps-<season>/: games with their source pages, outside.csv, teams.csv) live in the private
# data repo; CI checks it out and sets PRIVATE_DATA to it. Without it, the facts-only copies in data/seed are read, and
# a season has no outside.csv (no hidden teams in the fit), so a table made that way is not the published one.
RESULTS = Path(os.environ["PRIVATE_DATA"]).resolve() if os.environ.get("PRIVATE_DATA") else DATA / "seed"


def require_private_data(env=os.environ) -> None:
    """In CI the season's table is the published one, so it needs the private data (ADR 0029); a local run may go without."""
    if env.get("CI") == "true" and not env.get("PRIVATE_DATA"):
        raise SystemExit(
            "PRIVATE_DATA is not set: in CI the season's table is made from the private data repo's checkout (outside "
            "games, playoff sites), so set PRIVATE_DATA to it (ADR 0029)."
        )


MERCY = {"mercy_half", "mercy_2h"}
DUPLICATE_DAYS = 2  # twin of DUPLICATE_DAYS in apps/web/lib/duplicate-game.ts
OUTSIDE_PREFIX = "outside: "
# A school we do not list only informs the fit when it played two of our teams: with one game it connects nothing.
HIDDEN_MIN_OPPONENTS = 2
# Robot-read playoff games (ADR 0008) are listed home and away but were thought to be played mostly at neutral sites. The
# data say otherwise: the listed home team did as well as a home team. Fit on the posterior of all six seasons, the share of
# the season's home edge it earned is 1.65 (SE 0.43), and walk-forward log loss on the 491 scored playoff games falls at
# every step from a share of 0 (0.3655) to 1 (0.3621; mean margin miss 14.3 to 14.1): see docs/research/ratings-before-
# after-2026-11-11.md. A share is capped at 1, so the listed home team gets the whole edge. A hand capture says for itself.
PLAYOFF_EDGE = 1.0


def forfeit_score(a: int, b: int) -> bool:
    """A forfeit as robot-read results record it: 1-0 or 2-0. Twin of `forfeitScore` in apps/web/lib/games.ts."""
    return max(a, b) <= 2 and min(a, b) == 0 and a != b


def no_contest_score(a: int, b: int) -> bool:
    """0-0: no game was played."""
    return a == 0 and b == 0


@dataclass(frozen=True)
class Game:
    date: str
    home: str
    away: str
    home_score: int
    away_score: int
    end_reason: str
    edge: (
        float  # share of the season's home edge the home team gets: 1 home, 0 neutral, PLAYOFF_EDGE robot-read playoff
    )
    kind: str  # rated | forfeit | no_contest | duplicate

    @property
    def margin(self) -> int:
        return self.home_score - self.away_score

    @property
    def censored(self) -> bool:
        return self.end_reason in MERCY or (self.end_reason == "unknown" and abs(self.margin) >= 45)


def read_files(paths, neutral: frozenset = frozenset(), corrections: Corrections | None = None):
    """Each played game once, in file order: a game already read (same date and teams) from an earlier file is skipped,
    so the first file wins. `neutral` keys are robot-read playoff games (they get PLAYOFF_EDGE of a home edge), unless a
    hand capture, which says for itself. `corrections` (default: data/corrections, corrections.py) merge program names,
    fix scores and drop games listed in error, before any of the rules above look at a row."""
    if corrections is None:
        corrections = load_corrections()
    seen: set[tuple[str, frozenset[str]]] = set()
    for path in paths:
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                if not r["home_score"]:
                    continue  # not played yet
                # `neutral` keys are the files' own spellings; everything after the correction uses the merged names.
                raw_key = (r["game_date"], frozenset((r["home"], r["away"])))
                fixed = apply_to_game(
                    corrections,
                    r["game_date"],
                    r["home"],
                    r["away"],
                    int(r["home_score"]),
                    int(r["away_score"]),
                    r["end_reason"],
                )
                if fixed is None:
                    continue  # voided: listed in error
                home, away, home_score, away_score, end_reason = fixed
                key = (r["game_date"], frozenset((home, away)))
                if key in seen:
                    continue
                seen.add(key)
                if r["neutral"] == "true":
                    edge = 0.0
                elif raw_key in neutral and "maxpreps-" in str(path):
                    edge = PLAYOFF_EDGE
                else:
                    edge = 1.0
                yield Game(r["game_date"], home, away, home_score, away_score, end_reason, edge, "rated")


def read_outside(path) -> list[Game]:
    """Games of one of our schools against one that is not, from a season's outside.csv (tools/league-watch/maxpreps.mjs);
    the opponent is named by its page address. Home edge as listed (MaxPreps marks one side home)."""
    if not path or not Path(path).exists():
        return []
    games = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            theirs = OUTSIDE_PREFIX + r["opponent_url"]
            home = r["team_is_home"] == "true"
            ours_s, theirs_s = int(r["team_score"]), int(r["opponent_score"])
            games.append(
                Game(
                    r["game_date"],
                    r["team"] if home else theirs,
                    theirs if home else r["team"],
                    ours_s if home else theirs_s,
                    theirs_s if home else ours_s,
                    "unknown",
                    1.0,
                    "rated",
                )
            )
    return games


def classify(games: list[Game]) -> list[Game]:
    """Give each game its kind (see the module docstring); order is kept."""
    out: list[Game] = []
    first: dict[tuple, list[dt.date]] = {}
    for i in sorted(range(len(games)), key=lambda i: games[i].date):  # earlier dates win a duplicate
        g = games[i]
        kind = "rated"
        scores = tuple(sorted(((g.home, g.home_score), (g.away, g.away_score))))
        day = dt.date.fromisoformat(g.date)
        if any(abs((day - d).days) <= DUPLICATE_DAYS for d in first.get(scores, [])):
            kind = "duplicate"
        else:
            first.setdefault(scores, []).append(day)
            if g.end_reason == "forfeit" or forfeit_score(g.home_score, g.away_score):
                kind = "forfeit"
            elif no_contest_score(g.home_score, g.away_score):
                kind = "no_contest"
        out.append((i, Game(g.date, g.home, g.away, g.home_score, g.away_score, g.end_reason, g.edge, kind)))
    out.sort(key=lambda t: t[0])
    return [g for _, g in out]


def group_labels() -> dict[str, str]:
    """School -> the group whose mean level its rating starts from: UIL Division I, UIL Division II, TAPPS, TAIAO, TCAF,
    Independent (today's alignments, as everywhere). A school two leagues list (Sherman Grayson Christian School) takes the
    first file's, which is the one the games file names."""
    labels: dict[str, str] = {}
    for folder in ("uil-2026-28", "tapps-2026-28", "private-2026"):
        path = DATA / "seed" / folder / "alignments.csv"
        if not path.exists():
            continue
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                label = f"UIL {r['division']}" if r["league"] == "UIL" else r["league"]
                labels.setdefault(r["school"], label)
    return labels


OUTSIDE_GROUP = "Outside"
UNLISTED_GROUP = "Unlisted"  # a school in the games but in no alignment (the invented sample schools)


@dataclass(frozen=True)
class Season:
    """Fit-ready rows over one team index: listed teams first, then hidden ones."""

    teams: list[str]
    n_listed: int
    g: Games
    dates: np.ndarray  # ISO date of each row of g, in date order
    hidden_row: np.ndarray  # row involves a hidden team
    groups: list[str]  # group label of each team
    records: dict[str, list[int]]  # [won, lost, tied] over listed-vs-listed games, forfeits in, duplicates out
    report: dict[str, int]


def prepare(
    paths,
    outside: str | Path | None = None,
    neutral: frozenset = frozenset(),
    before: str | None = None,
    corrections: Corrections | None = None,
) -> Season | None:
    """Rows for the fit from game files (first file wins a duplicate), plus the season's outside.csv, if any. With `before`
    (an ISO date), only games played before that day; whether a game is a duplicate is judged on the whole season first.
    None when no game is left to rate. `corrections`: see read_files."""
    listed = list(read_files(paths, neutral, corrections))
    hidden_all = read_outside(outside)
    games = classify(listed + hidden_all)
    listed_n = len(listed)

    # A hidden team stays if it played HIDDEN_MIN_OPPONENTS different listed schools (counted on rated games).
    opponents: dict[str, set[str]] = {}
    for g in games[listed_n:]:
        if g.kind == "rated":
            ours, theirs = (g.away, g.home) if g.home.startswith(OUTSIDE_PREFIX) else (g.home, g.away)
            opponents.setdefault(theirs, set()).add(ours)
    keep = {t for t, ours in opponents.items() if len(ours) >= HIDDEN_MIN_OPPONENTS}

    report = {
        "forfeits": 0,
        "no_contests": 0,
        "duplicates": 0,
        "ties": 0,
        "outside_games": 0,
        "outside_games_left_out": 0,
        "hidden_teams": len(keep),
    }
    records: dict[str, list[int]] = {}
    fit_rows = []
    for i, g in enumerate(games):
        if before and g.date >= before:
            continue
        outside_game = i >= listed_n
        hidden = (g.home if g.home.startswith(OUTSIDE_PREFIX) else g.away) if outside_game else None
        if g.kind == "duplicate":
            report["duplicates"] += 1
            continue
        if outside_game and (g.kind != "rated" or hidden not in keep):
            report["outside_games_left_out"] += 1
            continue
        if not outside_game:
            if g.kind == "no_contest":
                report["no_contests"] += 1
                continue  # not a game: not even a record line
            for side, sign in (("home", 1), ("away", -1)):
                wlt = records.setdefault(getattr(g, side), [0, 0, 0])
                wlt[0 if sign * g.margin > 0 else 1 if sign * g.margin < 0 else 2] += 1
            if g.kind == "forfeit":
                report["forfeits"] += 1
                continue
        else:
            report["outside_games"] += 1
        if g.margin == 0:
            report["ties"] += 1
        fit_rows.append(g)
    if not fit_rows:
        return None
    fit_rows.sort(key=lambda g: g.date)  # stable: same-day games keep file order

    # Listed teams get indexes first, hidden ones after, so a table is the first n_listed.
    index: dict[str, int] = {}
    for g in fit_rows:
        for t in (g.home, g.away):
            if not t.startswith(OUTSIDE_PREFIX):
                index.setdefault(t, len(index))
    n_listed = len(index)
    for g in fit_rows:
        for t in (g.home, g.away):
            index.setdefault(t, len(index))
    labels = group_labels()
    group = [
        OUTSIDE_GROUP if t.startswith(OUTSIDE_PREFIX) else labels.get(t, UNLISTED_GROUP)
        for t in index  # dict order is insertion order, which is the index
    ]
    g = Games(
        np.array([index[r.home] for r in fit_rows]),
        np.array([index[r.away] for r in fit_rows]),
        np.array([r.margin for r in fit_rows], dtype=float),
        np.array([r.edge for r in fit_rows], dtype=float),
        np.array([r.censored for r in fit_rows], dtype=bool),
    )
    hidden_row = np.array([r.home.startswith(OUTSIDE_PREFIX) or r.away.startswith(OUTSIDE_PREFIX) for r in fit_rows])
    return Season(list(index), n_listed, g, np.array([r.date for r in fit_rows]), hidden_row, group, records, report)
