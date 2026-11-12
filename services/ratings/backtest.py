"""Gate G3's walk-forward backtest (plan v1.2 section 4; v1.1 section 8.4).

Every week of a season is predicted from the games played before that week's Monday, by three things:

  model       the censored-margin fit, its season prior pulled from last season's final rating by rho
  elo         plain margin-capped Elo (model.elo), the first v1.1 baseline
  last_season last season's final rating plus home field, the second v1.1 baseline ("Beat last season's rating plus
              home-field, and plain Elo", plan 8.4); a team with no rating last season counts as average

`model_no_prior` (rho = 0, the league-mean prior the site's tables use today) is reported beside them, not as a baseline.

A game is scored only once both teams have FEW_GAMES rated games before the week (the site's few-games threshold,
`FEW_GAMES` in apps/web/lib/ratings.ts, which the Results page's week-before projections use too), and never when it
ended in a tie or a forfeit. Every model scores the same games.

uv run python run.py --backtest   writes data/ratings/backtest.json
"""

import csv
import itertools
import json
import multiprocessing
import os
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, timedelta

import numpy as np
from model import CAP, SETTINGS, Fit, Games, Settings, elo, fit_best, subset
from rows import DATA, OUTSIDE_GROUP, UNLISTED_GROUP, Season, prepare
from run import Last, playoff_sites, prior_for, rate, season_files, season_outside
from scipy.optimize import minimize, minimize_scalar
from scipy.stats import norm

SEASONS = tuple(range(2021, 2027))
FEW_GAMES = 4
RHO_FIT_SEASONS = (2021, 2022, 2023, 2024)  # 2021 supplies the first prior; 2022 to 2024 are the games rho is fit on
RHO_CHECK_SEASONS = (2025, 2026)
G3_FROM = 2022
G3_METRICS = ("mae", "brier")  # plan 8.4: "out-of-sample margin error and Brier score"
PROBABILITY_FLOOR = 1e-6
OUT = DATA / "ratings" / "backtest.json"


def season_data(season: int) -> Season:
    """A season's rated games in date order, over one team index (team names carry no information about results), with
    its hidden opponents: the same rows the site's table rates (rows.prepare)."""
    s = prepare(season_files(season), season_outside(season), playoff_sites(season))
    if s is None:
        raise SystemExit(f"no games for {season}")
    return s


def monday(day: str) -> str:
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


@dataclass(frozen=True)
class Predictions:
    games: np.ndarray  # positions of the games scored in the season's data
    margin: np.ndarray  # their recorded margins (home minus away)
    week: np.ndarray  # the Monday of each game's week
    mu: dict[str, np.ndarray]  # each model's predicted margin
    sigma: dict[str, np.ndarray]
    blowout: dict[str, tuple[np.ndarray, np.ndarray]]  # P(m >= 45), P(m <= -45)


def walk_forward(data: Season, fitters: dict[str, Callable[[Games], Fit]]) -> Predictions:
    """Predict each week from games dated before that week's Monday. A fitter sees only that earlier slice. A game is
    scored only between two listed schools (a hidden opponent has no table row), once both have FEW_GAMES rated games."""
    weeks = np.array([monday(d) for d in data.dates])
    n = len(data.teams)
    keep: list[int] = []
    out: dict[str, list[tuple[np.ndarray, float, tuple[np.ndarray, np.ndarray]]]] = {name: [] for name in fitters}
    for week in sorted(set(weeks)):
        before = data.dates < week
        train = subset(data.g, before)
        listed = before & ~data.hidden_row  # what the site counts as a team's rated games
        rated = np.bincount(np.concatenate([data.g.home[listed], data.g.away[listed]]), minlength=n)
        in_week = np.flatnonzero(weeks == week)
        scorable = [
            i
            for i in in_week
            if not data.hidden_row[i]
            and data.g.margin[i] != 0
            and min(rated[data.g.home[i]], rated[data.g.away[i]]) >= FEW_GAMES
        ]
        if not scorable:
            continue
        test = subset(data.g, np.array(scorable))
        keep += scorable
        for name, fitter in fitters.items():
            model = fitter(train)
            out[name].append((model.margin(test), model.sigma, model.blowout_probabilities(test)))
    order = np.array(keep, dtype=int)
    return Predictions(
        order,
        data.g.margin[order],
        weeks[order],
        {name: np.concatenate([m for m, _, _ in parts]) for name, parts in out.items()},
        {name: np.concatenate([np.full(len(m), s) for m, s, _ in parts]) for name, parts in out.items()},
        {
            name: (np.concatenate([b[0] for _, _, b in parts]), np.concatenate([b[1] for _, _, b in parts]))
            for name, parts in out.items()
        },
    )


@dataclass(frozen=True)
class Final:
    """A finished season, as the next season's prior and as the "last season's rating" baseline."""

    last: Last
    home_field: float
    sigma: float

    def vector(self, data: Season) -> np.ndarray:
        """Last season's rating for each team of `data` (0, the average, for a team without one)."""
        return np.array([self.last.ratings.get(t, 0.0) for t in data.teams])


def final_of(data: Season, last: Final | None, st: Settings) -> Final:
    """A finished season's ratings (centered on the average listed team), home edge and spread, from the same fit the
    site's table uses, with that season's own prior."""
    r = rate(data, last.last if last else None, st)
    listed = data.teams[: data.n_listed]
    ratings = {t: float(r.ratings[i]) for i, t in enumerate(listed)}
    return Final(Last(ratings, r.group_means), r.model.home_field, r.model.sigma)


def warm(fitter: Callable[[Games, Fit | None], Fit]) -> Callable[[Games], Fit]:
    """Start each week's search from the week before's fit: the same optimum, found in far fewer steps."""
    last: list[Fit] = []

    def run(train: Games) -> Fit:
        result = fitter(train, last[0] if last else None)
        last[:] = [result]
        return result

    return run


def predict_season(data: Season, last: Final | None, st: Settings, extra: bool = True) -> Predictions:
    """The model (this season's prior from `last`) and, with `extra`, the model without last season's ratings and both
    baselines."""
    n = len(data.teams)
    prior, groups = prior_for(data, last.last if last else None, st)
    fitters = {"model": warm(lambda train, start: fit_best(train, n, st.tau, prior, start, groups, st.sigma_prior))}
    if extra:
        flat, flat_groups = prior_for(data, None, st)
        fitters["model_no_prior"] = warm(
            lambda train, start: fit_best(train, n, st.tau, flat, start, flat_groups, st.sigma_prior)
        )
        fitters["elo"] = lambda train: elo(train, n)
        if last:
            carried = Fit(last.vector(data), last.home_field, last.sigma)
            fitters["last_season"] = lambda _train: carried
    return walk_forward(data, fitters)


def chain(data: dict[int, Season], seasons: tuple[int, ...], st: Settings) -> dict[int, Final]:
    """Each season's final table, rated from the one before it as the site rates (rate with that season's prior), keyed by
    the season that FOLLOWS it: finals[s] is what season s starts from."""
    finals: dict[int, Final] = {}
    previous: Final | None = None
    for s in seasons:
        if s - 1 in data and s - 1 in seasons:
            previous = final_of(data[s - 1], previous if s - 2 in seasons else None, st)
            finals[s] = previous
    return finals


MODELS = ("model", "elo", "last_season", "model_no_prior")
# What the grid tries, jointly (walk-forward log loss on RHO_FIT_SEASONS; RHO_CHECK_SEASONS played no part in the choice).
# Settings the grid found flat are NOT searched at the full grid: SIDE_SETTINGS moves each from the chosen point and the
# result is reported (sensitivity), so a reader can see they do not matter.
# rho is fixed at 0.6 (the owner, Nov 12, 2026): the grid's best was 1.0 (top of 0.6, 0.8, 0.9, 1.0), which kept a 1-9 team
# with a strong last season near the middle of the table; he chose less carryover. tau and the rest are tuned at 0.6.
RHO_GRID = (0.6,)
TAU_GRID = (20.0, 25.0, 30.0, 35.0)
SIDE_SETTINGS = (("sigma_center", (12.0, 22.0)), ("group_sd", (7.0, 30.0)))
BANDS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 1.0001)
SCORECARD_BANDS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.99, 1.0001)  # coarser: a split holds a few hundred games


def logistic_probability(mu: np.ndarray, scale: float) -> np.ndarray:
    return np.clip(1.0 / (1.0 + np.exp(-mu / scale)), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR)


def log_loss_of(p: np.ndarray, home_won: np.ndarray) -> float:
    return float(-np.log(np.where(home_won, p, 1 - p)).mean())


def fit_scale(mu: np.ndarray, margin: np.ndarray) -> float:
    """The logistic scale (points) with the lowest log loss on these predictions."""
    home_won = margin > 0
    return float(
        minimize_scalar(
            lambda s: log_loss_of(logistic_probability(mu, s), home_won), bounds=(3, 100), method="bounded"
        ).x
    )


def score(mu: np.ndarray, p: np.ndarray, margin: np.ndarray) -> dict[str, float]:
    """Winner picks, margin error (both sides clipped at the 45-point rule, which a final cannot show beyond), and the
    win probability's log loss and Brier score."""
    home_won = margin > 0
    return {
        "accuracy": float(((mu > 0) == home_won).mean()),
        "mae": float(np.abs(np.clip(mu, -CAP, CAP) - np.clip(margin, -CAP, CAP)).mean()),
        "log_loss": log_loss_of(p, home_won),
        "brier": float(((p - home_won) ** 2).mean()),
    }


def rounded(d: dict[str, float]) -> dict[str, float]:
    return {k: round(v, 4) for k, v in d.items()}


def pooled(parts: dict[int, Predictions], name: str, years) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.concatenate([parts[y].mu[name] for y in years]),
        np.concatenate([parts[y].margin for y in years]),
    )


def blowout_row(p: Predictions) -> dict[str, float]:
    """Mean predicted blowout chances (the fit's normal, uncalibrated, never shown on the site) against how often games
    really ended 45 or more apart."""
    home, away = p.blowout["model"]
    return {
        "home_predicted": round(float(home.mean()), 4),
        "home_observed": round(float((p.margin >= CAP).mean()), 4),
        "away_predicted": round(float(away.mean()), 4),
        "away_observed": round(float((p.margin <= -CAP).mean()), 4),
    }


_WORK: dict = {}


def evaluate(st: Settings) -> dict:
    """One point of the grid: rate the seasons in order under `st`, predict RHO_FIT_SEASONS and RHO_CHECK_SEASONS with the
    model alone, and score each with the logistic scale that suits it best."""
    data, seasons = _WORK["data"], _WORK["seasons"]
    finals = chain(data, seasons, st)
    row: dict = {"rho": st.rho, "tau": st.tau, "sigma_center": st.sigma_center, "group_sd": st.group_sd}
    for label, years in (("fit", RHO_FIT_SEASONS), ("check", RHO_CHECK_SEASONS)):
        parts = {y: predict_season(data[y], finals[y], st, extra=False) for y in years if y in finals}
        if not parts:
            row[f"{label}_log_loss"] = None
            continue
        mu, margin = pooled(parts, "model", list(parts))
        row[f"{label}_log_loss"] = round(log_loss_of(logistic_probability(mu, fit_scale(mu, margin)), margin > 0), 4)
    return row


def tune(
    data: dict[int, Season], seasons: tuple[int, ...], processes: int = 1
) -> tuple[Settings, list[dict], list[dict]]:
    """The grid over rho and tau (the rest at SETTINGS), then each flat setting moved off the chosen point. Returns the
    chosen settings, the grid and the sensitivity rows."""
    _WORK.update(data=data, seasons=seasons)
    run = [replace(SETTINGS, rho=r, tau=t) for r in RHO_GRID for t in TAU_GRID]
    rows = map_rows(run, processes)
    best = min(
        (r for r in rows if r["fit_log_loss"] is not None), key=lambda r: (r["fit_log_loss"], r["rho"], r["tau"])
    )
    chosen = replace(SETTINGS, rho=best["rho"], tau=best["tau"])
    side = [replace(chosen, **{name: v}) for name, values in SIDE_SETTINGS for v in values]
    return chosen, rows, map_rows(side, processes)


def map_rows(run: list[Settings], processes: int) -> list[dict]:
    if processes <= 1 or len(run) == 1:
        return [evaluate(st) for st in run]
    with multiprocessing.get_context("fork").Pool(min(processes, len(run))) as pool:
        return pool.map(evaluate, run, chunksize=1)


def calibration_study(parts: dict[int, Predictions], years: list[int]) -> dict:
    """Which map from a projected margin to a win probability is best, by leave-one-season-out log loss on the model's
    walk-forward predictions over `years`: each season is scored with parameters fit on the others."""
    families = {
        "normal_scaled_by_week_sigma": (lambda mu, sg, th: norm.cdf(mu / (th[0] * sg)), [1.5]),
        "logistic_scaled_by_week_sigma": (lambda mu, sg, th: 1 / (1 + np.exp(-mu / (th[0] * sg))), [0.9]),
        "normal_constant": (lambda mu, sg, th: norm.cdf(mu / th[0]), [26.0]),
        "logistic_constant": (lambda mu, sg, th: 1 / (1 + np.exp(-mu / th[0])), [16.0]),
    }
    mu = {y: parts[y].mu["model"] for y in years}
    sg = {y: parts[y].sigma["model"] for y in years}
    won = {y: parts[y].margin > 0 for y in years}
    out = {}
    for name, (f, x0) in families.items():
        total, count = 0.0, 0
        for held in years:
            others = [y for y in years if y != held]
            m = np.concatenate([mu[y] for y in others])
            g = np.concatenate([sg[y] for y in others])
            w = np.concatenate([won[y] for y in others])
            theta = minimize(
                lambda th, f=f, m=m, g=g, w=w: log_loss_of(
                    np.clip(f(m, g, th), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR), w
                ),
                x0,
                method="Nelder-Mead",
            ).x
            p = np.clip(f(mu[held], sg[held], theta), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR)
            total += log_loss_of(p, won[held]) * len(p)
            count += len(p)
        out[name] = round(total / count, 4)
    return out


def band_table(p: np.ndarray, margin: np.ndarray, bands: tuple[float, ...] = BANDS) -> list[dict]:
    """Said versus happened for the favorite: each band of the favorite's win probability, how many games, the average
    probability said and how often the favorite won."""
    favorite_p = np.maximum(p, 1 - p)
    favorite_won = np.where(p >= 0.5, margin > 0, margin < 0)
    rows = []
    for lo, hi in itertools.pairwise(bands):
        m = (favorite_p >= lo) & (favorite_p < hi)
        if m.any():
            rows.append(
                {
                    "from": lo,
                    "to": min(hi, 1.0),
                    "games": int(m.sum()),
                    "said": round(float(favorite_p[m].mean()), 4),
                    "happened": round(float(favorite_won[m].mean()), 4),
                }
            )
    return rows


def playoff_keys(season: int) -> frozenset:
    """Playoff games of a season as (date, both teams): the robot-read bracket games plus any hand capture, the same set
    apps/web/lib/games.ts playoffGameKeys gives the site."""
    keys = set(playoff_sites(season))
    for path in DATA.glob(f"seed/*/playoffs-{season}.csv"):
        with open(path, newline="") as f:
            keys |= {(r["game_date"], frozenset((r["home"], r["away"]))) for r in csv.DictReader(f)}
    return frozenset(keys)


def organization(group: str) -> str | None:
    """A team's organization from its group label (rows.group_labels): UIL Division I and II are both UIL; a school we
    do not list has none."""
    if group in (OUTSIDE_GROUP, UNLISTED_GROUP):
        return None
    return "UIL" if group.startswith("UIL") else group


def scorecard(parts: dict[int, Predictions], data: dict[int, Season], years: list[int], probability) -> dict:
    """The favorite's chance said versus how often the favorite won (the site's /rankings/how scorecard), on the
    walk-forward games of `years` with the leave-one-season-out calibrated chance, split by season, by regular season
    versus playoffs, and by organization (a game counts under each side's organization, so those rows overlap)."""
    chance, margin, season, playoff = [], [], [], []
    orgs: list[set[str]] = []
    for s in years:
        p, d = parts[s], data[s]
        keys = playoff_keys(s)
        home, away = d.g.home[p.games], d.g.away[p.games]
        chance.append(probability(p, "model", s))
        margin.append(p.margin)
        season += [s] * len(p.games)
        for i, h, a in zip(p.games, home, away, strict=True):
            playoff.append((d.dates[i], frozenset((d.teams[h], d.teams[a]))) in keys)
            orgs.append({o for o in (organization(d.groups[h]), organization(d.groups[a])) if o})
    chance, margin = np.concatenate(chance), np.concatenate(margin)
    season, playoff = np.array(season), np.array(playoff)

    def row(label: str, keep: np.ndarray) -> list[dict]:
        if not keep.any():
            return []  # a split with no games (a synthetic test season has no playoffs) is left out
        favorite = np.maximum(chance[keep], 1 - chance[keep])
        won = np.where(chance[keep] >= 0.5, margin[keep] > 0, margin[keep] < 0)
        return [
            {
                "label": label,
                "games": int(keep.sum()),
                "said": round(float(favorite.mean()), 4),
                "happened": round(float(won.mean()), 4),
                "bands": band_table(chance[keep], margin[keep], SCORECARD_BANDS),
            }
        ]

    leagues = sorted({o for group in orgs for o in group})
    return {
        "bands": list(SCORECARD_BANDS[:-1]) + [1.0],
        "season": [r for s in years for r in row(str(s), season == s)],
        "phase": row("Regular season", ~playoff) + row("Playoffs", playoff),
        "league": [r for o in leagues for r in row(o, np.array([o in group for group in orgs]))],
    }


def backtest(load: Callable[[int], Season], seasons: tuple[int, ...] = SEASONS, processes: int = 1) -> dict:
    data = {s: load(s) for s in seasons}
    st, grid, sensitivity = tune(data, seasons, processes)
    finals = chain(data, seasons, st)
    parts = {s: predict_season(data[s], finals.get(s), st) for s in seasons}

    # Each model's win probability is the logistic of its projected margin at the scale that suits the OTHER seasons
    # (leave one out), so a model is not graded on the games its scale was fit to, and no model is graded on a probability
    # it was never built to give (Elo and last season's rating have no sigma worth using).
    calibrated = [s for s in seasons if s >= G3_FROM]
    scales: dict[str, dict[int, float]] = {}
    for name in MODELS:
        have = [s for s in seasons if name in parts[s].mu]
        for s in seasons:
            if name not in parts[s].mu:
                continue
            others = [y for y in calibrated if y != s and y in have]
            mu, margin = pooled(parts, name, others)
            scales.setdefault(name, {})[s] = fit_scale(mu, margin)

    def probability(p: Predictions, name: str, s: int) -> np.ndarray:
        return logistic_probability(p.mu[name], scales[name][s])

    rows, per_season = [], {}
    for s in seasons:
        p = parts[s]
        row: dict = {"season": s, "games": len(p.margin)}
        for name in MODELS:
            row[name] = rounded(score(p.mu[name], probability(p, name, s), p.margin)) if name in p.mu else None
        row["model_raw_normal_log_loss"] = round(
            log_loss_of(
                np.clip(norm.cdf(p.mu["model"] / p.sigma["model"]), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR),
                p.margin > 0,
            ),
            4,
        )
        row["blowout"] = blowout_row(p)
        rows.append(row)
        per_season[s] = row

    def overall(years: list[int]) -> dict:
        row: dict = {"games": sum(len(parts[s].margin) for s in years)}
        for name in MODELS:
            if not all(name in parts[s].mu for s in years):
                row[name] = None
                continue
            mu, margin = pooled(parts, name, years)
            p = np.concatenate([probability(parts[s], name, s) for s in years])
            row[name] = rounded(score(mu, p, margin))
        return row

    gate = {
        str(s): {
            m: bool(per_season[s]["model"][m] < min(per_season[s]["elo"][m], per_season[s]["last_season"][m]))
            for m in G3_METRICS
        }
        for s in seasons
        if s >= G3_FROM
    }
    gate_accuracy = {
        str(s): bool(
            per_season[s]["model"]["accuracy"]
            > max(per_season[s]["elo"]["accuracy"], per_season[s]["last_season"]["accuracy"])
        )
        for s in seasons
        if s >= G3_FROM
    }
    # Said versus happened, pooled over the G3 seasons: the leave-one-season-out probabilities, and the fit's own normal
    # chance (what the site showed before calibration) beside them.
    mu, margin = pooled(parts, "model", calibrated)
    cal_p = np.concatenate([probability(parts[s], "model", s) for s in calibrated])
    raw_p = np.clip(
        norm.cdf(mu / np.concatenate([parts[s].sigma["model"] for s in calibrated])),
        PROBABILITY_FLOOR,
        1 - PROBABILITY_FLOOR,
    )
    scale = round(fit_scale(mu, margin), 2)
    return {
        "settings": {
            "few_games": FEW_GAMES,
            "tau": st.tau,
            "rho": st.rho,
            "sigma_prior": st.sigma_center,
            "sigma_prior_sd": st.sigma_sd,
            "group_sd": st.group_sd,
            "weeks": "Monday to Sunday; each week predicted from games before its Monday",
            "margin_error_clip": CAP,
            "baselines": {
                "elo": "margin-capped Elo (model.elo)",
                "last_season": "last season's final rating plus its home edge; 2021 has none",
            },
            "model_no_prior": "the same model (league means, no hidden-team change) with no last-season ratings",
            "grid_seasons": [s for s in RHO_FIT_SEASONS if s in data and s - 1 in data],
            "check_seasons": [s for s in RHO_CHECK_SEASONS if s in data and s - 1 in data],
            "rho_grid": list(RHO_GRID),
            "tau_grid": list(TAU_GRID),
        },
        "grid": grid,
        "sensitivity": sensitivity,
        "calibration": {
            "family": "logistic",
            "scale": scale,
            "fit_seasons": calibrated,
            "scale_by_left_out_season": {str(s): round(scales["model"][s], 2) for s in seasons},
            "candidates_loso_log_loss": calibration_study(parts, calibrated),
            "bands_calibrated": band_table(cal_p, margin),
            "bands_fit_normal": band_table(raw_p, margin),
        },
        "scorecard": scorecard(parts, data, calibrated, probability),
        "seasons": rows,
        "overall": overall(list(seasons)),
        "overall_from_2022": overall([s for s in seasons if s >= G3_FROM]),
        "g3": {
            "metrics": list(G3_METRICS),
            "beats_both_baselines": gate,
            "winner_pick_beats_both_baselines": gate_accuracy,
            "passes": all(all(v.values()) for v in gate.values()) and all(gate_accuracy.values()),
        },
    }


def main() -> None:
    result = backtest(season_data, processes=os.cpu_count() or 1)
    OUT.write_text(json.dumps(result, indent=1) + "\n")
    s = result["settings"]
    print(
        f"{OUT}: rho {s['rho']}, tau {s['tau']}, scale {result['calibration']['scale']}, G3 passes: {result['g3']['passes']}"
    )
    for row in result["seasons"]:
        print(row["season"], row["games"], {k: row[k] for k in ("model", "elo", "last_season") if row[k]})
