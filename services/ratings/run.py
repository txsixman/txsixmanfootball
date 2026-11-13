"""Compare the models on simulated seasons, or rate captured games.

uv run python run.py --simulate
uv run python run.py ../../data/seed/uil-2026-28/playoffs-2026.csv
uv run python run.py --json <table.json> <games.csv>...   the table the site shows (CI writes it, see ci.yml).
    Files are read in order; a game already read (same date and teams) is skipped, so list hand captures first.
uv run python run.py --season 2026   the same, for every game file of that season, into data/ratings/2026.json. A season
    starts from the one before it (data/ratings/2025.json), so rate seasons in order: 2021, 2022, ...
uv run python run.py --backtest   Gate G3's walk-forward backtest over seasons 2021 to 2026, into data/ratings/backtest.json

What data/ratings/<season>.json holds (the site's pages read it; every number is rounded to a tenth):
  season, games           rated games between listed schools (forfeits, no contests and duplicates left out, rows.py)
  games_outside           rated games against schools outside our alignments (hidden teams: they inform the fit)
  home_field, sigma       the season's home edge (points) and the model's game-to-game spread, as fit
  playoff_edge            share of home_field the listed home team gets in a robot-read playoff game (rows.PLAYOFF_EDGE)
  calibration             win probability = calibrated(margin, sigma): model.CALIBRATION, what the site shows instead of
                          the fit's raw normal chance (apps/web/lib/projection.ts is its twin)
  model                   the settings the table was fit with (rho, tau, sigma prior, group sd) and `prior_season`
  group_means             each group's mean rating (UIL I, UIL II, TAPPS, TAIAO, TCAF, Independent), points above the
                          average listed team
  report                  what was left out and why: forfeits, no_contests, duplicates, ties (non-zero, kept),
                          outside_games, outside_games_left_out, hidden_teams
  weeks                   each results week's Sunday (a week runs Monday to Sunday, as on the site's Results pages)
  week_sigma, week_home_field   sigma and home edge as fit on the games through each week's Sunday (same order)
  teams[]:
    rating, sd            points above the average listed team, and its standard deviation (a Laplace approximation of
                          the posterior: rating +/- sd is a range the data cannot tell apart)
    rated, rated_outside  rated games against listed schools and against hidden teams: the site's ONE definition of
                          games rated (apps/web/lib/week-rankings.ts reads rated_trend, it does not count its own)
    won, lost, tied       record over listed schools, forfeits in, duplicates and no contests out
    was                   rating through the Sunday before the latest results week (null if unrated then)
    trend, rated_trend    rating and rated games through each week of `weeks` (null before a first rated game)
"""

import csv
import datetime as dt
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from model import (
    CALIBRATION,
    SETTINGS,
    Fit,
    Groups,
    Settings,
    elo,
    fit,
    fit_best,
    rating_sd,
    simulate,
    subset,
)
from rows import DATA, PLAYOFF_EDGE, RESULTS, Season, prepare, require_private_data

# Rounded to a tenth, so a rerun on another machine does not churn the file over floating-point noise.
TENTH = 1


@dataclass(frozen=True)
class Last:
    """Last season's final table, as the next season's prior: each team's rating and each group's mean."""

    ratings: dict[str, float]
    group_means: dict[str, float]


def last_from_file(season: int) -> Last | None:
    """The prior season's table from data/ratings/<season - 1>.json, or None if there is none."""
    path = DATA / "ratings" / f"{season - 1}.json"
    if not path.exists():
        return None
    table = json.loads(path.read_text())
    return Last({t["team"]: t["rating"] for t in table["teams"]}, table.get("group_means", {}))


def prior_for(s: Season, last: Last | None, st: Settings) -> tuple[np.ndarray, Groups]:
    """The season prior (plan section 8.2): a team's rating is pulled to its group's mean plus `rho` times how far it sat
    above or below its group's mean last season (0 for a team with no rating then); a group's mean is pulled to last
    season's."""
    labels = sorted(set(s.groups))
    where = {label: i for i, label in enumerate(labels)}
    index = np.array([where[x] for x in s.groups])
    means = last.group_means if last else {}
    center = np.array([means.get(label, 0.0) for label in labels])
    prior = np.array(
        [
            st.rho * (last.ratings[t] - means.get(group, 0.0)) if last and t in last.ratings else 0.0
            for t, group in zip(s.teams, s.groups, strict=True)
        ]
    )
    return prior, Groups(index, center, st.group_sd)


@dataclass(frozen=True)
class Rated:
    season: Season
    model: Fit
    ratings: np.ndarray  # every team, points above the average listed team
    group_means: dict[str, float]
    rated: np.ndarray  # rated games against listed schools, per team
    rated_outside: np.ndarray  # and against hidden teams
    prior: np.ndarray
    groups: Groups
    settings: Settings

    @property
    def weights(self) -> np.ndarray:
        w = np.zeros(len(self.season.teams))
        w[: self.season.n_listed] = 1 / self.season.n_listed
        return w


def rate(s: Season, last: Last | None = None, st: Settings = SETTINGS, start: Fit | None = None) -> Rated:
    """Fit a season's rows (a model with this season's prior from `last`), and read the result as the site does."""
    prior, groups = prior_for(s, last, st)
    n = len(s.teams)
    model = fit_best(s.g, n, st.tau, prior, start, groups, st.sigma_prior)
    shift = float(model.ratings[: s.n_listed].mean())
    rated = np.zeros(n, dtype=int)
    rated_outside = np.zeros(n, dtype=int)
    for h, a, hidden in zip(s.g.home, s.g.away, s.hidden_row, strict=True):
        target = rated_outside if hidden else rated
        target[h] += 1
        target[a] += 1
    labels = sorted(set(s.groups))
    return Rated(
        s,
        model,
        model.ratings - shift,
        {label: float(m - shift) for label, m in zip(labels, model.group_means, strict=True)},
        rated,
        rated_outside,
        prior,
        groups,
        st,
    )


def centered_sd(r: Rated) -> np.ndarray:
    return rating_sd(r.model, r.season.g, r.settings.tau, r.prior, r.groups, r.settings.sigma_prior, r.weights)


def table(
    *paths: str,
    before: str | None = None,
    neutral: frozenset = frozenset(),
    outside: str | Path | None = None,
    last: Last | None = None,
    st: Settings = SETTINGS,
    with_sd: bool = True,
) -> dict:
    """The ratings table for the site. Ratings are points above the average listed team, on a neutral field.

    Forfeits count in a team's record but not in the fit (plan section 8.2), so a team whose only game is a forfeit is
    not rated. `rated` is how many games a rating rests on (rows.py): the site's one definition."""
    s = prepare(paths, outside, neutral, before)
    if s is None:
        return {"games": 0, "teams": []}
    r = rate(s, last, st)
    sd = centered_sd(r) if with_sd else None
    rows = []
    for i, name in enumerate(s.teams[: s.n_listed]):
        won, lost, tied = s.records.get(name, [0, 0, 0])
        rows.append(
            {
                "team": name,
                "rating": round(float(r.ratings[i]), TENTH) + 0.0,  # + 0.0: never write -0.0
                **({"sd": round(float(sd[i]), TENTH)} if sd is not None else {}),
                "rated": int(r.rated[i]),
                "rated_outside": int(r.rated_outside[i]),
                "won": won,
                "lost": lost,
                "tied": tied,
            }
        )
    rows.sort(key=lambda row: (-row["rating"], row["team"]))
    hidden = int(s.hidden_row.sum())
    # home_field and sigma let the site project a margin and a win probability for games not yet played.
    return {
        "games": len(s.g.margin) - hidden,
        "games_outside": hidden,
        "home_field": round(r.model.home_field, TENTH),
        "sigma": round(r.model.sigma, TENTH),
        "playoff_edge": PLAYOFF_EDGE,
        "calibration": CALIBRATION,
        "model": {
            "rho": st.rho,
            "tau": st.tau,
            "sigma_prior": st.sigma_center,
            "group_sd": st.group_sd,
            "prior_season": bool(last),
        },
        "group_means": {k: round(v, TENTH) + 0.0 for k, v in sorted(r.group_means.items())},
        "report": s.report,
        "teams": rows,
    }


def compare(seeds: int = 20) -> None:
    totals: dict[str, list[list[float]]] = {name: [] for name in ("censored", "ignoring 45-pt rule", "capped Elo")}
    censored_share = []
    for seed in range(seeds):
        g, truth, week = simulate(seed)
        n = len(truth)
        train, test = subset(g, week < 8), subset(g, week >= 8)
        censored_share.append(g.censored.mean())
        for name, model in (
            ("censored", fit(train, n)),
            ("ignoring 45-pt rule", fit(train, n, censor=False)),
            ("capped Elo", elo(train, n)),
        ):
            error = (model.ratings - model.ratings.mean()) - truth
            outcome = (test.margin > 0).astype(float)
            totals[name].append(
                [
                    float(np.sqrt((error**2).mean())),
                    float(np.abs(model.recorded_margin(test) - test.margin).mean()),
                    float(((model.win_probability(test) - outcome) ** 2).mean()),
                ]
            )
    print(f"{seeds} simulated seasons, {np.mean(censored_share):.0%} of games ended by the 45-point rule")
    print(f"{'model':<22}{'rating error':>14}{'margin MAE':>12}{'Brier':>9}")
    for name, rows in totals.items():
        rating, mae, brier = np.mean(rows, axis=0)
        print(f"{name:<22}{rating:>14.2f}{mae:>12.2f}{brier:>9.4f}")


def close(a, b, tolerance: float) -> bool:
    """Equal lists of numbers (or None) up to `tolerance`, so a rerun on another machine is the same table."""
    if a is None or b is None:
        return a is b
    return len(a) == len(b) and all(
        (x is None and y is None) or (x is not None and y is not None and abs(x - y) <= tolerance)
        for x, y in zip(a, b, strict=True)
    )


def same_table(old: dict, new: dict, tolerance: float = 0.15) -> bool:
    """True when only rounding differs, so a rerun on another machine does not commit a new table."""
    if old.get("games") != new["games"] or len(old.get("teams", [])) != len(new["teams"]):
        return False
    if any(k not in old or abs(old[k] - new[k]) > tolerance for k in ("home_field", "sigma") if k in new):
        return False
    if old.get("weeks") != new.get("weeks") or old.get("report") != new.get("report"):
        return False
    if old.get("calibration") != new.get("calibration") or old.get("model") != new.get("model"):
        return False
    if not all(close(old.get(k), new.get(k), tolerance) for k in ("week_sigma", "week_home_field")):
        return False
    if old.get("group_means", {}).keys() != new.get("group_means", {}).keys() or any(
        abs(old["group_means"][k] - v) > tolerance for k, v in new.get("group_means", {}).items()
    ):
        return False
    before = {row["team"]: row for row in old["teams"]}
    for row in new["teams"]:
        was = before.get(row["team"])
        if was is None or abs(was["rating"] - row["rating"]) > tolerance:
            return False
        if ("sd" in was) != ("sd" in row) or ("sd" in row and abs(was["sd"] - row["sd"]) > tolerance):
            return False
        keys = ("rated", "rated_outside", "won", "lost", "tied", "rated_trend")
        if any(was.get(k) != row.get(k) for k in keys):
            return False
        if not close(was.get("trend", []), row.get("trend", []), tolerance):
            return False
        then, now = was.get("was", "missing"), row.get("was", "missing")
        if (then is None) != (now is None) or (
            isinstance(now, float) and (not isinstance(then, float) or abs(then - now) > tolerance)
        ):
            return False
    return True


def week_sundays(dates, skip: int = 0) -> list[dt.date]:
    """The Sunday of every Monday-to-Sunday week from the first game's week through the last's (the site's Results weeks,
    apps/web/lib/weeks.ts), less the first `skip`."""
    first, last = dt.date.fromisoformat(min(dates)), dt.date.fromisoformat(max(dates))
    sunday = first + dt.timedelta(days=6 - first.weekday())
    out = []
    while sunday < last + dt.timedelta(days=7):
        out.append(sunday)
        sunday += dt.timedelta(days=7)
    return out[skip:]


# The first weeks are not published as a trend: until teams share opponents the fit has little to go on.
TREND_SKIP_WEEKS = 3


def with_trend(
    files: list[str],
    neutral: frozenset = frozenset(),
    skip: int = TREND_SKIP_WEEKS,
    outside: str | Path | None = None,
    last: Last | None = None,
    st: Settings = SETTINGS,
) -> dict:
    """The table, each team carrying `trend` and `rated_trend` (its rating and rated games through every week's Sunday),
    `was` (its rating through the Sunday before the latest results week: None if unrated then), and the table carrying
    the week list, the sigma and the home edge as fit each week."""
    now = table(*files, neutral=neutral, outside=outside, last=last, st=st)
    s = prepare(files, outside, neutral)
    if s is None:
        return now
    sundays = week_sundays(s.dates)
    snapshots: list[dict | None] = []
    warm: Fit | None = None
    for w in sundays:
        part = prepare(files, outside, neutral, before=(w + dt.timedelta(days=1)).isoformat())
        if part is None:
            snapshots.append(None)
            continue
        try:
            same_size = warm is not None and len(warm.ratings) == len(part.teams)
            r = rate(part, last, st, start=warm if same_size else None)
        except RuntimeError as e:  # a fit that does not converge leaves that week empty, and says so
            print(f"week ending {w}: no ratings ({e})", file=sys.stderr)
            snapshots.append(None)
            continue
        warm = r.model
        listed = part.teams[: part.n_listed]
        snapshots.append(
            {
                "rating": {t: round(float(r.ratings[i]), TENTH) + 0.0 for i, t in enumerate(listed)},
                "rated": {t: int(r.rated[i]) for i, t in enumerate(listed)},
                "sigma": round(r.model.sigma, TENTH),
                "home_field": round(r.model.home_field, TENTH),
            }
        )

    def at(week: int, key: str, team: str):
        snap = snapshots[week]
        return snap[key].get(team) if snap else None

    previous = len(sundays) - 2  # the Sunday before the latest results week
    shown = list(range(skip, len(sundays)))
    now["weeks"] = [sundays[i].isoformat() for i in shown]
    now["week_sigma"] = [snapshots[i]["sigma"] if snapshots[i] else None for i in shown]
    now["week_home_field"] = [snapshots[i]["home_field"] if snapshots[i] else None for i in shown]
    now["teams"] = [
        {
            **row,
            "was": at(previous, "rating", row["team"]) if previous >= 0 else None,
            "trend": [at(i, "rating", row["team"]) for i in shown],
            "rated_trend": [at(i, "rated", row["team"]) for i in shown],
        }
        for row in now["teams"]
    ]
    return now


def season_files(season: int) -> list[str]:
    """Hand captures first (they win a duplicate), then robot-read results (ADR 0008)."""
    hand = sorted(DATA.glob(f"seed/*/playoffs-{season}.csv"))
    robot = sorted(RESULTS.glob(f"maxpreps-{season}/games.csv"))
    return [str(p) for p in hand + robot]


def season_outside(season: int) -> Path:
    """Games against schools outside our alignments (tools/league-watch/maxpreps.mjs); absent for a season not read since."""
    return RESULTS / f"maxpreps-{season}" / "outside.csv"


def playoff_sites(season: int) -> frozenset:
    """Robot-read playoff games (ADR 0008). Their source marks every game home or away, but playoff games are mostly at
    neutral sites, so each gets only PLAYOFF_EDGE of a home edge. A hand capture of the same game wins and says for itself."""
    path = RESULTS / f"maxpreps-{season}" / "playoffs.csv"
    if not path.exists():
        return frozenset()
    with open(path, newline="") as f:
        return frozenset((r["game_date"], frozenset((r["home"], r["away"]))) for r in csv.DictReader(f))


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--season":
        require_private_data()
        season = int(sys.argv[2])
        files = season_files(season)
        if not files:
            sys.exit(f"no game files for {season}")
        last = last_from_file(season)
        result = {
            "season": season,
            **with_trend(files, playoff_sites(season), outside=season_outside(season), last=last),
        }
        out = DATA / "ratings" / f"{season}.json"
        out.parent.mkdir(exist_ok=True)
        if out.exists() and same_table(json.loads(out.read_text()), result):
            print(f"{out}: unchanged ({result['games']} games)")
            return
        out.write_text(json.dumps(result, indent=1) + "\n")
        print(f"{out}: {result['games']} games, {len(result['teams'])} teams from {len(files)} files")
        print(f"left out or flagged: {result['report']}")
        return
    if sys.argv[1:] == ["--backtest"]:
        from backtest import main as backtest_main

        backtest_main()
        return
    if len(sys.argv) >= 4 and sys.argv[1] == "--json":
        result = table(*sys.argv[3:])
        with open(sys.argv[2], "w") as f:
            json.dump(result, f, indent=1)
            f.write("\n")
        return
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--simulate":
        compare()
        return
    s = prepare([sys.argv[1]])
    if s is None:
        print("0 played games in the file, nothing to rate")
        return
    r = rate(s)
    print(f"{len(s.g.margin)} games, {s.n_listed} teams, sigma {r.model.sigma:.1f}")
    for i in np.argsort(-r.ratings[: s.n_listed]):
        print(f"{r.ratings[i]:>7.1f}  {s.teams[int(i)]}")


if __name__ == "__main__":
    main()
