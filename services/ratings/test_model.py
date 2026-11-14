import json
from types import SimpleNamespace

import numpy as np
from model import Fit, Games, Groups, converged, elo, fit, fit_best, neg_log_posterior, simulate, subset
from scipy.optimize import check_grad


def sample_header():
    with open("sample-games.csv") as f:
        return f.readline()


def games(rows):
    """Rows of (home, away, margin, neutral site, ended by the 45-point rule)."""
    a = np.array(rows, dtype=float)
    return Games(a[:, 0].astype(int), a[:, 1].astype(int), a[:, 2], 1.0 - a[:, 3], a[:, 4].astype(bool))


def test_gradient_matches_the_function():
    g, truth, _ = simulate(1, n_teams=20, weeks=4)
    params = np.r_[truth * 0.5, 3.0, np.log(16.0)]
    error = check_grad(lambda p: neg_log_posterior(p, g, 30)[0], lambda p: neg_log_posterior(p, g, 30)[1], params)
    assert error < 1e-2


def test_a_home_mercy_game_counts_as_at_least_45():
    capped = games([(0, 1, 45, True, True)] * 3)
    plain = games([(0, 1, 45, True, False)] * 3)
    assert fit(capped, 2, tau=1000).margin(capped)[0] > fit(plain, 2, tau=1000).margin(plain)[0]


def test_a_bracket_that_fits_perfectly_keeps_a_sensible_sigma():
    bracket = games([(0, 1, 20, True, False), (2, 3, 14, True, False), (0, 2, 7, True, False)])
    assert 8 < fit(bracket, 4).sigma < 30


def test_an_away_mercy_game_favors_the_away_team():
    g = games([(0, 1, -45, True, True)] * 3)
    model = fit(g, 2)
    assert model.ratings[1] > model.ratings[0]


def test_swapping_sides_at_a_neutral_site_changes_nothing():
    a = games([(0, 1, 45, True, True), (1, 2, 10, True, False), (2, 0, -20, True, False)])
    b = games([(1, 0, -45, True, True), (2, 1, -10, True, False), (0, 2, 20, True, False)])
    assert np.allclose(fit(a, 3).ratings, fit(b, 3).ratings, atol=1e-2)


def test_no_mercy_games_means_censoring_changes_nothing():
    g = games([(0, 1, 14, True, False), (1, 2, 8, True, False), (2, 0, -20, True, False), (0, 2, 12, True, False)])
    assert np.allclose(fit(g, 3).ratings, fit(g, 3, censor=False).ratings, atol=1e-3)


def test_censoring_recovers_true_strength_better_than_ignoring_the_rule():
    better = []
    for seed in range(6):
        g, truth, week = simulate(seed)
        train = subset(g, week < 8)

        def error(m, truth=truth):
            return np.sqrt(((m.ratings - m.ratings.mean() - truth) ** 2).mean())

        better.append(error(fit(train, len(truth))) < error(fit(train, len(truth), censor=False)))
    assert all(better)


def test_elo_favors_the_winner():
    g = games([(0, 1, 30, True, False)] * 3)  # the first game has no rating difference to scale from
    model = elo(g, 2)
    assert model.ratings[0] > model.ratings[1]


def test_the_site_table_counts_forfeits_in_records_but_not_ratings():
    from run import table

    t = table("sample-games.csv")
    by_team = {row["team"]: row for row in t["teams"]}
    assert t["games"] == 14  # 15 rows, one forfeit
    assert t["teams"][0]["team"] == "Red Bluff Creek"
    assert "Salt Fork" not in by_team  # its only game was a forfeit
    assert (by_team["Caprock"]["won"], by_team["Caprock"]["lost"]) == (2, 1)
    assert 5 < t["sigma"] < 40 and abs(t["home_field"]) < 20  # what the site projects margins with
    assert by_team["Caprock"]["rated"] == 2  # three games, one of them its forfeit win over Salt Fork
    assert abs(sum(row["rating"] for row in t["teams"])) < 0.5  # centered on the average rated team


def test_the_committed_sample_table_is_current():
    import json

    from run import table

    # Another machine's optimizer may land a hair away, so ratings match to within rounding and order is not compared.
    with open("../../apps/web/lib/demo-ratings.json") as f:
        committed = {row.pop("team"): row for row in json.load(f)["teams"]}
    fresh = {row.pop("team"): row for row in table("sample-games.csv")["teams"]}
    rerun = "rerun: uv run python run.py --json ../../apps/web/lib/demo-ratings.json sample-games.csv"
    assert committed.keys() == fresh.keys(), rerun
    for team, row in fresh.items():
        for key in ("rating", "sd"):
            assert abs(row.pop(key) - committed[team].pop(key)) <= 0.15, f"{team} {key}: {rerun}"
        assert row == committed[team], f"{team}: {rerun}"


def test_an_empty_capture_file_gives_an_empty_table(tmp_path):
    from run import table

    empty = tmp_path / "games.csv"
    empty.write_text(sample_header())
    assert table(str(empty)) == {"games": 0, "teams": []}


def test_a_game_in_two_files_counts_once_and_the_first_file_wins(tmp_path):
    from run import table

    header = sample_header()
    hand = tmp_path / "hand.csv"
    scraped = tmp_path / "scraped.csv"
    hand.write_text(header + "I,area,2026-11-20,Cedar Gap,Dry Wash,true,50,28,regulation,4,,\n")
    scraped.write_text(
        header
        + "I,season,2026-11-20,Dry Wash,Cedar Gap,false,28,49,unknown,,,\n"  # same game, other way round
        + "I,season,2026-09-04,Dry Wash,Bluestem,false,40,34,unknown,,,\n"
    )
    t = table(str(hand), str(scraped))
    assert t["games"] == 2
    by_team = {row["team"]: row for row in t["teams"]}
    assert (by_team["Cedar Gap"]["won"], by_team["Cedar Gap"]["lost"]) == (1, 0)


def test_was_is_the_rating_through_the_sunday_before_the_latest_results_week(tmp_path):
    from run import with_trend

    header = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"
    rows = [
        "I,season,2026-10-02,Cedar Gap,Dry Wash,false,40,20,unknown,,u,",
        "I,season,2026-10-09,Dry Wash,Salt Fork,false,30,28,unknown,,u,",
        "I,season,2026-10-12,Cedar Gap,Salt Fork,false,41,14,unknown,,u,",  # a Monday: the latest week starts here
        "I,season,2026-10-16,Salt Fork,Mesa Verde,false,50,6,mercy_2h,3,u,",  # Mesa Verde is new that week
    ]
    path = tmp_path / "games.csv"
    path.write_text(header + "\n".join(rows) + "\n")
    result = with_trend([str(path)], skip=0)
    by_team = {row["team"]: row for row in result["teams"]}
    assert result["weeks"][-2:] == ["2026-10-11", "2026-10-18"]
    assert by_team["Mesa Verde"]["was"] is None
    assert by_team["Cedar Gap"]["was"] == by_team["Cedar Gap"]["trend"][-2]  # the Sunday before, not seven days back
    assert by_team["Salt Fork"]["rating"] != by_team["Salt Fork"]["was"]  # its rout and the Monday game moved it
    assert by_team["Cedar Gap"]["rated_trend"][-2:] == [1, 2]  # Dry Wash, then Salt Fork on the Monday


def test_a_rerun_that_differs_only_by_rounding_is_the_same_table():
    from run import same_table

    row = {"team": "A", "rating": 5.0, "rated": 1, "won": 1, "lost": 0, "tied": 0}
    old = {"games": 2, "teams": [row]}
    assert same_table(old, {"games": 2, "teams": [{**row, "rating": 5.1}]})
    assert not same_table(old, {"games": 2, "teams": [{**row, "rating": 5.3}]})
    assert not same_table(old, {"games": 3, "teams": [{**row, "won": 2, "rated": 2}]})
    assert not same_table({"games": 2, "teams": [{k: v for k, v in row.items() if k != "rated"}]}, old)  # older file


def test_week_earlier_ratings_compare_across_every_team():
    from run import same_table

    rows = [
        {"team": t, "rating": r, "rated": 3, "won": 2, "lost": 1, "tied": 0, "was": w}
        for t, r, w in (("A", 9.0, 8.0), ("B", 1.0, None), ("C", -9.0, -7.0))
    ]
    old = {"games": 5, "teams": rows}
    assert same_table(old, {"games": 5, "teams": [{**r, "was": r["was"] and r["was"] + 0.1} for r in rows]})
    assert not same_table(old, {"games": 5, "teams": [*rows[:2], {**rows[2], "was": -6.0}]})
    assert not same_table(old, {"games": 5, "teams": [rows[0], {**rows[1], "was": 0.5}, rows[2]]})


def test_an_abnormal_stop_counts_only_at_the_optimum():
    stop = lambda jac: SimpleNamespace(success=False, message="ABNORMAL: ", jac=np.array(jac))
    assert converged(stop([1e-7, -2e-6]))
    assert not converged(stop([1e-7, 0.5]))
    assert not converged(SimpleNamespace(success=False, message="STOP: TOTAL NO. OF ITERATIONS", jac=np.zeros(2)))


def test_a_success_flag_far_from_a_stationary_point_is_not_convergence():
    plateau = SimpleNamespace(success=True, message="CONVERGENCE: RELATIVE REDUCTION OF F", jac=np.array([0.0, 171.3]))
    assert not converged(plateau)
    assert converged(SimpleNamespace(success=True, message="CONVERGENCE", jac=np.array([1e-5, -2e-5])))


def cold_start_plateau():
    """Games on which one cold L-BFGS-B search stops far from the optimum (the real case is the 2025 season through
    Sept 28: sigma 61 and objective 1244, against sigma 18.9 and 1079). Widely spread teams, three weeks, many 45-point
    finals: the first step, taken on a huge sigma gradient, overshoots."""
    g, _, _ = simulate(18, n_teams=40, weeks=3, spread=40.0)
    return g, 40


def objective(m: Fit, g: Games, prior_mean=0.0) -> float:
    return neg_log_posterior(np.r_[m.ratings, m.home_field, np.log(m.sigma)], g, 30.0, prior_mean)[0]


def test_a_cold_fit_does_not_stop_on_a_plateau_and_matches_a_warm_one():
    from scipy.optimize import minimize

    g, n = cold_start_plateau()
    x0 = np.zeros(n + 2)
    x0[-1] = np.log(17.0)
    options = {"maxiter": 20000, "ftol": 1e-15, "gtol": 1e-9}
    one_search = minimize(neg_log_posterior, x0, args=(g, 30.0, 0.0), jac=True, method="L-BFGS-B", options=options)
    # (Before z-scores were clipped, one cold search stopped here short of the optimum, at a gradient of 9.8.)
    cold = fit(g, n)
    assert cold.sigma < 25 and one_search.fun >= objective(cold, g) - 1e-6
    warm = fit(g, n, start=Fit(np.zeros(n), 0.0, 10.0))
    assert abs(objective(cold, g) - objective(warm, g)) < 1e-6
    assert np.abs(cold.ratings - warm.ratings).max() < 0.05
    assert objective(cold, g) <= objective(fit_best(g, n), g) + 1e-6


def test_the_season_table_rates_a_cold_start_plateau_at_the_optimum(tmp_path):
    from run import table

    g, _ = cold_start_plateau()
    header = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"
    rows = []
    for i, (h, a, m, c) in enumerate(zip(g.home, g.away, g.margin, g.censored, strict=True)):
        home, away = (50 + int(m), 50) if m > 0 else (50, 50 - int(m))
        day = f"2026-{9 + i // 28:02d}-{1 + i % 28:02d}"  # one date a game, so none is read as a duplicate
        reason = "mercy_half" if c else "regulation"
        rows.append(f"I,,{day},T{h},T{a},false,{home},{away},{reason},4,,\n")
    path = tmp_path / "games.csv"
    path.write_text(header + "".join(rows))
    t = table(str(path))
    assert t["games"] == len(g.margin) and t["sigma"] < 25


def test_a_robot_read_playoff_game_gets_the_playoff_share_of_a_home_edge_and_a_hand_neutral_none(tmp_path):
    from rows import PLAYOFF_EDGE, prepare

    header = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"
    robot = tmp_path / "maxpreps-2030"
    robot.mkdir()
    (robot / "games.csv").write_text(
        header + "I,season,2030-09-05,Alpha,Beta,false,40,20,unknown,,https://example.test/1,\n"
        "I,season,2030-11-20,Alpha,Gamma,false,30,28,unknown,,https://example.test/2,\n"
        "I,season,2030-11-21,Beta,Gamma,true,30,21,unknown,,https://example.test/3,\n"  # a hand capture said neutral
    )
    key = ("2030-11-20", frozenset(("Alpha", "Gamma")))
    s = prepare([str(robot / "games.csv")], neutral=frozenset({key}))
    assert s.g.edge.tolist() == [1.0, PLAYOFF_EDGE, 0.0] and 0 <= PLAYOFF_EDGE <= 1


def test_a_trend_holds_each_teams_rating_at_the_end_of_every_week(tmp_path):
    header = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"
    rows = [
        ("2030-09-05", "Alpha", "Beta", 40, 20),
        ("2030-09-12", "Gamma", "Alpha", 10, 30),
        ("2030-09-26", "Beta", "Gamma", 28, 27),
    ]
    path = tmp_path / "games.csv"
    path.write_text(
        header
        + "".join(
            f"I,season,{d},{h},{a},false,{hs},{as_},unknown,,https://example.test/{i},\n"
            for i, (d, h, a, hs, as_) in enumerate(rows)
        )
    )
    from run import with_trend

    result = with_trend([str(path)], skip=0)  # the season here is four weeks long
    assert result["weeks"] == ["2030-09-08", "2030-09-15", "2030-09-22", "2030-09-29"]
    trend = {row["team"]: row["trend"] for row in result["teams"]}
    assert trend["Gamma"][0] is None and trend["Gamma"][1] is not None
    assert trend["Alpha"][2] == trend["Alpha"][1]  # an open week changes nothing
    assert trend["Alpha"][-1] == next(row["rating"] for row in result["teams"] if row["team"] == "Alpha")


def test_a_games_week_before_ratings_do_not_change_once_its_own_result_is_rated(tmp_path):
    """The site projects a played game from the week before it (apps/web/lib/pregame.ts): `trend`, `week_sigma` and
    `week_home_field` at the last Sunday before its date. Rating the game, or any later one, must leave those unchanged."""
    from run import with_trend

    header = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"
    rows = [
        ("2030-09-05", "Alpha", "Beta", 40, 20),
        ("2030-09-05", "Gamma", "Delta", 35, 34),
        ("2030-09-12", "Gamma", "Alpha", 10, 30),
        ("2030-09-12", "Delta", "Beta", 22, 28),
        ("2030-09-19", "Beta", "Gamma", 28, 27),
        ("2030-09-19", "Alpha", "Delta", 50, 6),
    ]
    later = ("2030-10-02", "Delta", "Gamma", 60, 0)  # the game, then rated: a result far from any projection

    def run(games, name):
        path = tmp_path / name
        path.write_text(
            header
            + "".join(
                f"I,season,{d},{h},{a},false,{hs},{as_},unknown,,https://example.test/{i},\n"
                for i, (d, h, a, hs, as_) in enumerate(games)
            )
        )
        return with_trend([str(path)], skip=0)

    before, after = run(rows, "before.csv"), run([*rows, later], "after.csv")
    weeks = len(before["weeks"])
    assert after["weeks"][:weeks] == before["weeks"] and max(before["weeks"]) < later[0]
    assert after["week_sigma"][:weeks] == before["week_sigma"]
    assert after["week_home_field"][:weeks] == before["week_home_field"]
    was = {row["team"]: row["trend"] for row in before["teams"]}
    now = {row["team"]: row["trend"][:weeks] for row in after["teams"]}
    assert now == was
    # The current ratings do move: they count the game, which is why a played game is never projected from them.
    rating = lambda table: {row["team"]: row["rating"] for row in table["teams"]}
    assert rating(after)["Delta"] > rating(before)["Delta"]


def prior_season(seed=0, n_teams=24, weeks=8, start="2030-09-02"):
    """An invented season with dates: week w's games are on the Thursday of the w-th week after `start` (a Monday)."""
    import datetime as dt

    from rows import Season

    g, _, week = simulate(seed, n_teams=n_teams, weeks=weeks)
    order = np.argsort(week, kind="stable")
    base = dt.date.fromisoformat(start)
    dates = np.array([(base + dt.timedelta(days=7 * int(w) + 3)).isoformat() for w in week[order]])
    teams = [f"Team {i}" for i in range(n_teams)]
    games_ = subset(g, order)
    return Season(teams, n_teams, games_, dates, np.zeros(len(dates), dtype=bool), ["Unlisted"] * n_teams, {}, {})


def test_a_prior_mean_pulls_a_teams_rating_and_the_gradient_still_matches():
    g, truth, _ = simulate(2, n_teams=20, weeks=4)
    prior = np.linspace(-10, 10, 20)
    params = np.r_[truth * 0.5, 3.0, np.log(16.0)]
    error = check_grad(
        lambda p: neg_log_posterior(p, g, 30, prior)[0], lambda p: neg_log_posterior(p, g, 30, prior)[1], params
    )
    assert error < 1e-2
    idle = subset(g, (g.home != 0) & (g.away != 0))  # team 0 plays no one: it sits at its prior
    assert abs(fit(idle, 20, prior_mean=prior).ratings[0] - prior[0]) < 1e-3


def test_the_best_of_several_starts_is_never_worse_than_one():
    g, _, week = simulate(3, n_teams=40, weeks=6)
    train = subset(g, week < 5)
    one, best = fit(train, 40), fit_best(train, 40)

    def objective(m):
        return neg_log_posterior(np.r_[m.ratings, m.home_field, np.log(m.sigma)], train, 30.0)[0]

    assert objective(best) <= objective(one) + 1e-6


def test_both_blowout_chances_are_probabilities_that_leave_a_middle():
    from scipy.stats import norm

    model = Fit(np.array([0.0, 0.0, 30.0, -30.0]), home_field=5.0, sigma=20.0)
    g = games([(0, 1, 0, False, False), (2, 3, 0, True, False), (3, 2, 0, False, False), (0, 2, 0, True, False)])
    home, away = model.blowout_probabilities(g)
    mu, s = model.margin(g), model.sigma
    middle = norm.cdf((45 - mu) / s) - norm.cdf((-45 - mu) / s)
    assert np.allclose(home + away + middle, 1)
    assert ((home > 0) & (away > 0) & (home + away < 1)).all()
    assert (home <= model.win_probability(g)).all() and (away <= 1 - model.win_probability(g)).all()
    assert home[1] > home[0] > home[2]  # a 60-point favorite, a 5-point home edge, a 25-point underdog at home
    assert away[2] > away[0] > away[1]


def test_equal_teams_at_a_neutral_site_have_equal_blowout_chances_in_both_directions():
    model = Fit(np.zeros(2), home_field=6.0, sigma=22.0)
    home, away = model.blowout_probabilities(games([(0, 1, 0, True, False)]))
    assert np.isclose(home[0], away[0]) and 0 < home[0] < 0.05
    swapped = model.blowout_probabilities(games([(1, 0, 0, True, False)]))
    assert np.allclose(swapped, (home, away))


def test_walk_forward_fits_only_on_games_before_the_week_it_predicts():
    from backtest import monday, walk_forward

    data = prior_season()
    seen = []

    def spy(train):
        seen.append(len(train.margin))
        return Fit(np.zeros(len(data.teams)), 0.0, 20.0)

    walk_forward(data, {"spy": spy})
    allowed = {int((data.dates < m).sum()) for m in {monday(d) for d in data.dates}}
    assert seen and set(seen) <= allowed
    assert max(seen) < len(data.dates)  # the last week is predicted without itself


def test_changing_a_week_and_later_never_changes_predictions_for_that_week_or_earlier():
    from dataclasses import replace

    from backtest import monday, predict_season
    from model import SETTINGS

    data = prior_season(seed=4)
    weeks = np.array([monday(d) for d in data.dates])
    cutoff = sorted(set(weeks))[5]
    late = weeks >= cutoff
    changed = replace(data.g, margin=np.where(late, -data.g.margin - 7, data.g.margin))
    before = predict_season(data, None, SETTINGS)
    after = predict_season(replace(data, g=changed), None, SETTINGS)
    assert (before.games == after.games).all()  # which games are scored depends only on earlier games too
    upto = weeks[before.games] <= cutoff
    assert upto.any() and (~upto).any()
    for name in before.mu:
        assert np.allclose(before.mu[name][upto], after.mu[name][upto], atol=1e-6), name
    assert not np.allclose(before.mu["model"][~upto], after.mu["model"][~upto], atol=1e-3)  # the test can tell


def test_the_backtest_writes_the_same_numbers_on_a_rerun():
    from backtest import backtest

    seasons = {2021: prior_season(1), 2022: prior_season(2), 2023: prior_season(3)}
    first = backtest(seasons.__getitem__, seasons=(2021, 2022, 2023))
    second = backtest(seasons.__getitem__, seasons=(2021, 2022, 2023))
    assert json.dumps(first) == json.dumps(second)
    assert [row["season"] for row in first["seasons"]] == [2021, 2022, 2023]
    assert first["seasons"][0]["last_season"] is None and first["seasons"][1]["last_season"]["mae"] > 0
    assert (
        first["settings"]["rho"] in first["settings"]["rho_grid"]
        and first["settings"]["tau"] in first["settings"]["tau_grid"]
    )
    assert first["calibration"]["scale"] > 0 and set(first["calibration"]["candidates_loso_log_loss"])
    assert set(first["g3"]["beats_both_baselines"]) == {"2022", "2023"}


def test_the_scores_of_known_predictions():
    from backtest import score

    mu = np.array([10.0, -10.0, 60.0])
    margin = np.array([20.0, 5.0, 50.0])  # a right pick, a wrong pick, a 50-point win
    s = score(mu, 1 / (1 + np.exp(-mu / 16.0)), margin)
    assert np.isclose(s["accuracy"], 2 / 3)
    assert np.isclose(s["mae"], (10 + 15 + 0) / 3)  # 60 and 50 both read as 45
    assert 0 < s["brier"] < 1 and s["log_loss"] > 0


def test_the_committed_backtest_matches_this_codes_settings():
    import backtest
    from model import CALIBRATION, SETTINGS

    with open("../../data/ratings/backtest.json") as f:
        committed = json.load(f)
    rerun = "rerun: run.py --backtest, then copy its rho, tau and calibration scale into model.SETTINGS / CALIBRATION"
    assert committed["settings"]["few_games"] == backtest.FEW_GAMES
    assert committed["settings"]["rho_grid"] == list(backtest.RHO_GRID), rerun
    assert committed["settings"]["tau_grid"] == list(backtest.TAU_GRID), rerun
    assert (committed["settings"]["rho"], committed["settings"]["tau"]) == (SETTINGS.rho, SETTINGS.tau), rerun
    assert committed["calibration"]["scale"] == CALIBRATION["scale"], rerun
    assert [row["season"] for row in committed["seasons"]] == list(backtest.SEASONS), "rerun: run.py --backtest"
    assert committed["g3"]["passes"], "Gate G3: the model must beat Elo and last season's rating every season from 2022"


HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\n"


def robot_file(tmp_path, rows, name="games.csv"):
    """Robot-style rows (date, home, away, home score, away score): end_reason is always "unknown", as the reader writes."""
    path = tmp_path / name
    path.write_text(
        HEADER + "".join(f"I,season,{d},{h},{a},false,{hs},{as_},unknown,,u,\n" for d, h, a, hs, as_ in rows)
    )
    return str(path)


def test_forfeits_no_contests_and_duplicates_are_left_out_of_the_fit_and_counted(tmp_path):
    from rows import prepare

    path = robot_file(
        tmp_path,
        [
            ("2030-09-05", "Alpha", "Beta", 40, 20),
            ("2030-09-12", "Beta", "Gamma", 1, 0),  # a forfeit, the way the robot writes one
            ("2030-09-19", "Gamma", "Alpha", 0, 2),  # and one the other way round
            ("2030-09-26", "Alpha", "Delta", 0, 0),  # no contest
            ("2030-10-03", "Delta", "Beta", 33, 12),
            ("2030-10-04", "Beta", "Delta", 12, 33),  # the same game a day later, sides swapped
            ("2030-10-10", "Alpha", "Gamma", 35, 35),  # a real tie: kept, and counted
        ],
    )
    s = prepare([path])
    assert s.report == {**s.report, "forfeits": 2, "no_contests": 1, "duplicates": 1, "ties": 1}
    assert len(s.g.margin) == 3  # Alpha-Beta, Delta-Beta, the tie
    assert s.records["Beta"] == [1, 2, 0]  # a forfeit counts in a record: its win over Gamma, losses to Alpha and Delta
    assert s.records["Alpha"] == [2, 0, 1]  # Beta, Gamma's forfeit, the tie; the 0-0 with Delta is no game at all
    assert "Gamma" in s.teams  # its tie is a rated game


def test_the_forfeit_rule_is_the_one_the_pages_use():
    """apps/web/lib/games.ts forfeitScore, row by row (scripts/forfeit-rule.test.mjs checks the same table there)."""
    from rows import forfeit_score, no_contest_score

    with open("../../apps/web/lib/forfeit-cases.json") as f:
        cases = json.load(f)["cases"]
    for home, away, forfeit in cases:
        assert forfeit_score(home, away) == forfeit, (home, away)
    assert no_contest_score(0, 0) and not no_contest_score(2, 0) and not forfeit_score(0, 0)


def test_a_group_mean_is_fit_and_pulls_a_team_with_no_games():
    # Group 0 (teams 0, 1, 2) beats group 1 (3, 4) by a lot; team 5 (group 1) has no games and sits at its group's mean.
    g = games([(0, 3, 30, True, False), (1, 4, 28, True, False), (2, 3, 25, True, False), (0, 1, 3, True, False)])
    groups = Groups(np.array([0, 0, 0, 1, 1, 1]), np.zeros(2), 50.0)
    model = fit(g, 6, tau=15.0, groups=groups)
    assert model.group_means[0] - model.group_means[1] > 8
    assert abs(model.ratings[5] - model.group_means[1]) < 1e-3
    assert model.ratings[2] > model.ratings[3]


def test_the_gradient_with_group_means_and_a_partial_home_edge_matches_the_function():
    g, truth, _ = simulate(5, n_teams=18, weeks=4)
    g = Games(g.home, g.away, g.margin, np.where(np.arange(len(g.margin)) % 3 == 0, 0.5, g.edge), g.censored)
    groups = Groups(np.arange(18) % 3, np.array([5.0, -3.0, 0.0]), 12.0)
    prior = np.linspace(-4, 4, 18)
    params = np.r_[truth * 0.5, 3.0, np.log(16.0), 1.0, -1.0, 0.5]

    def value(p):
        return neg_log_posterior(p, g, 25, prior, groups, (np.log(17.0), 0.25))[0]

    def gradient(p):
        return neg_log_posterior(p, g, 25, prior, groups, (np.log(17.0), 0.25))[1]

    assert check_grad(value, gradient, params) < 1e-2


def test_a_partial_edge_moves_a_projected_margin_by_that_share_of_the_home_edge():
    model = Fit(np.array([10.0, 4.0]), home_field=6.0, sigma=20.0)
    g = games([(0, 1, 0, False, False), (0, 1, 0, True, False)])
    g = Games(g.home, g.away, g.margin, np.array([1.0, 0.5]), g.censored)
    assert model.margin(g).tolist() == [12.0, 9.0]


def test_a_runaway_step_does_not_overflow():
    import warnings

    g = games([(0, 1, 45, True, True), (1, 0, 45, True, True), (0, 1, 10, True, False)])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        value, grad = neg_log_posterior(np.r_[1e100, -1e100, 0.0, 2000.0], g, 30)
    assert np.isfinite(value) and np.isfinite(grad).all()


def test_sigma_never_collapses_on_a_first_week_that_every_rating_can_fit_exactly():
    from model import SIGMA_FLOOR

    g = games([(0, 1, 14, True, False), (2, 3, 7, True, False), (4, 5, 21, True, False)])
    model = fit(g, 6, tau=25.0)
    assert model.sigma >= SIGMA_FLOOR - 1e-9


def test_a_team_with_more_games_has_a_tighter_rating_range():
    from model import rating_sd

    g = games([(0, 1, 10, True, False)] * 6 + [(2, 1, 5, True, False)])
    model = fit(g, 4, tau=25.0)
    sd = rating_sd(model, g, 25.0, 0.0, None, (np.log(17.0), 0.25), np.full(4, 0.25))
    assert sd[0] < sd[2] < sd[3]  # six games, one game, none: the none sits at its prior, tau wide


def test_the_calibrated_win_probability_is_symmetric_monotone_and_has_no_certainty():
    from model import CALIBRATION, calibrated_probability

    p = calibrated_probability(np.array([-40.0, -10.0, 0.0, 10.0, 40.0, 140.0]))
    assert p[2] == 0.5 and np.isclose(p[0] + p[4], 1) and np.isclose(p[1] + p[3], 1)
    assert (np.diff(p) > 0).all() and p[-1] < 1.0
    assert abs(calibrated_probability(np.array([CALIBRATION["scale"]]))[0] - 1 / (1 + np.exp(-1))) < 1e-12


def test_a_school_outside_our_alignments_is_a_hidden_team_that_connects_two_of_ours(tmp_path):
    from rows import OUTSIDE_PREFIX, prepare

    games_file = robot_file(
        tmp_path, [("2030-09-05", "Alpha", "Beta", 40, 20), ("2030-09-12", "Gamma", "Delta", 30, 22)]
    )
    outside = tmp_path / "outside.csv"
    outside.write_text(
        "game_date,team,opponent,opponent_url,team_is_home,team_score,opponent_score,source_url\n"
        "2030-09-19,Alpha,Far Away,https://x.test/far/,true,50,6,u\n"
        "2030-09-26,Gamma,Far Away,https://x.test/far/,false,14,28,u\n"
        "2030-10-03,Beta,Lonely,https://x.test/lonely/,true,60,0,u\n"  # one of ours only: connects nothing
    )
    s = prepare([games_file], outside)
    hidden = [t for t in s.teams if t.startswith(OUTSIDE_PREFIX)]
    assert hidden == [OUTSIDE_PREFIX + "https://x.test/far/"] and s.n_listed == 4
    assert s.hidden_row.sum() == 2 and s.report["outside_games_left_out"] == 1 and s.report["hidden_teams"] == 1
    assert s.records["Alpha"] == [1, 0, 0]  # a record lists only the schools the site lists
    from run import rate

    r = rate(s)
    far = s.teams.index(hidden[0])
    assert r.rated[0] == 1 and r.rated_outside[0] == 1 and r.rated_outside[far] == 2
    assert (
        r.ratings[2] < r.ratings[0]
    )  # Gamma lost to the hidden team that Alpha beat by 44: the two groups are tied together


def test_the_table_shows_listed_teams_only_and_each_team_has_a_range(tmp_path):
    from run import table

    path = robot_file(tmp_path, [("2030-09-05", "Alpha", "Beta", 40, 20), ("2030-09-12", "Beta", "Gamma", 30, 22)])
    out = tmp_path / "outside.csv"
    out.write_text(
        "game_date,team,opponent,opponent_url,team_is_home,team_score,opponent_score,source_url\n"
        "2030-09-19,Alpha,Far,https://x.test/far/,true,50,6,u\n"
        "2030-09-26,Gamma,Far,https://x.test/far/,true,14,28,u\n"
    )
    t = table(path, outside=out)
    assert {row["team"] for row in t["teams"]} == {"Alpha", "Beta", "Gamma"}
    assert t["games"] == 2 and t["games_outside"] == 2
    assert all(row["sd"] > 0 for row in t["teams"]) and t["calibration"]["family"] == "logistic"


def test_weeks_run_monday_to_sunday_like_the_results_pages():
    from run import week_sundays

    got = week_sundays(["2026-08-27", "2026-09-04", "2026-09-07"])  # Thursday, Friday, then the next Monday
    assert [d.isoformat() for d in got] == ["2026-08-30", "2026-09-06", "2026-09-13"]
    assert all(d.weekday() == 6 for d in got)


def test_a_season_starts_from_last_seasons_gap_to_its_group(tmp_path):
    from model import Settings
    from rows import prepare
    from run import Last, prior_for

    s = prepare([robot_file(tmp_path, [("2030-09-05", "Alpha", "Beta", 40, 20)])])
    last = Last({"Alpha": 30.0, "Beta": -10.0}, {"Unlisted": 5.0})
    prior, groups = prior_for(s, last, Settings(rho=0.5))
    assert prior.tolist() == [12.5, -7.5]  # half of the gap to last season's group mean
    assert groups.center.tolist() == [5.0]
    assert prior_for(s, None, Settings())[0].tolist() == [0.0, 0.0]
