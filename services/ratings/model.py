"""Six-man ratings (plan section 8), with the 45-point rule treated as a censored margin.

A game that ends by the 45-point rule only tells us the margin was at least 45, in either direction.
The plan's formula covers a home blowout only; an away blowout needs the lower tail, added here.
"""

from dataclasses import dataclass, replace

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm

CAP = 45.0
# Weak prior on game-to-game noise. A bracket has about one game per team, so it can be fit perfectly and sigma
# would collapse to zero without this. The center is set by the walk-forward grid in backtest.py.
LOG_SIGMA_PRIOR = np.log(17.0)
LOG_SIGMA_PRIOR_SD = 0.25
MAX_RESTARTS = 4
# z-scores beyond this are clipped before they are squared or turned into hazards: a first optimizer step can leave the
# finite region, and exp() of a runaway z overflowed (RuntimeWarning, Nov 11, 2026). Real z-scores are under 10.
Z_CLIP = 1e3
# Sigma never goes below this (points). Early in a season a team has about one game, so the ratings can fit every game
# exactly and the likelihood rewards a vanishing sigma (0.03 on the first week of 2023): the optimizer then never settles.
# Real six-man margins vary by 15 to 25 points; the floor only catches the collapse.
SIGMA_FLOOR = 5.0


@dataclass(frozen=True)
class Settings:
    """What the walk-forward grid in backtest.py tunes. `tau`: how far a rating may sit from what its prior expects;
    `rho`: how much of last season's gap from its group a team keeps; `sigma_center` and `sigma_sd`: the weak prior on
    game-to-game noise (points; sd of its log); `group_sd`: how far a group's mean may move from last season's."""

    tau: float = 30.0
    # The owner, Nov 12, 2026: less carryover than the grid's best (1.0); backtest.py tunes the rest at 0.6.
    rho: float = 0.6
    sigma_center: float = 17.0
    sigma_sd: float = 0.25
    group_sd: float = 15.0

    @property
    def sigma_prior(self) -> tuple[float, float]:
        return float(np.log(self.sigma_center)), self.sigma_sd


SETTINGS = Settings()
# How a margin becomes the win probability the site shows (apps/web/lib/projection.ts is its twin): logistic in the
# projected margin, with a constant scale in points. Set from the walk-forward backtest (backtest.py, which reports the same
# numbers it fit and fails a test if these drift): the fit's own normal, with its sigma, was 0.36 log loss against 0.31
# here, and a constant scale beat the same family scaled by each week's sigma (backtest.json, calibration.candidates).
CALIBRATION: dict = {"family": "logistic", "scale": 15.57}


@dataclass(frozen=True)
class Games:
    home: np.ndarray
    away: np.ndarray
    margin: np.ndarray  # home minus away, as recorded
    edge: (
        np.ndarray
    )  # the share of the season's home edge the home team gets: 1 at home, 0 neutral, between for a playoff
    censored: np.ndarray  # ended by the 45-point rule


@dataclass(frozen=True)
class Groups:
    """Teams share a mean by group (UIL Division I, TAPPS, ...): each rating is pulled toward its group's mean, and the
    means are fit from the games, each pulled to its own prior center with spread `sd`."""

    index: np.ndarray  # team -> group number
    center: np.ndarray  # prior center of each group's mean
    sd: float

    def __len__(self) -> int:
        return len(self.center)


@dataclass(frozen=True)
class Fit:
    ratings: np.ndarray
    home_field: float
    sigma: float
    group_means: np.ndarray | None = None
    params: np.ndarray | None = None  # the fitted parameter vector, for rating_sd

    def margin(self, g: Games) -> np.ndarray:
        return self.ratings[g.home] - self.ratings[g.away] + self.home_field * g.edge

    def recorded_margin(self, g: Games) -> np.ndarray:
        """What a final can show: the 45-point rule stops the game, so projections beyond 45 display as 45+."""
        return np.clip(self.margin(g), -CAP, CAP)

    def win_probability(self, g: Games) -> np.ndarray:
        return norm.cdf(self.margin(g) / self.sigma)

    def blowout_probabilities(self, g: Games) -> tuple[np.ndarray, np.ndarray]:
        """P(m >= 45) and P(m <= -45), m being home minus away (plan section 8.2, v1.2 section 6): the 45-point rule
        can end a game either way. With the win probability's middle band they sum to one."""
        mu = self.margin(g)
        return norm.sf((CAP - mu) / self.sigma), norm.cdf((-CAP - mu) / self.sigma)


def calibrated_probability(mu: np.ndarray, calibration: dict | None = None) -> np.ndarray:
    """P(home team wins) for a projected margin `mu` (home minus away), the number the site shows. Exact twin of
    `project` in apps/web/lib/projection.ts."""
    scale = (calibration or CALIBRATION)["scale"]
    return 1.0 / (1.0 + np.exp(-np.asarray(mu) / scale))


def unpack(params: np.ndarray, groups: Groups | None):
    """(ratings, home_field, log_sigma, group means). Layout: ratings, home field, log sigma, then one mean per group."""
    k = len(groups) if groups is not None else 0
    n = len(params) - 2 - k
    return params[:n], params[n], params[n + 1], params[n + 2 :]


def neg_log_posterior(
    params: np.ndarray,
    g: Games,
    tau: float,
    prior_mean: np.ndarray | float = 0.0,
    groups: Groups | None = None,
    sigma_prior: tuple[float, float] | None = None,
) -> tuple[float, np.ndarray]:
    """`prior_mean` is where each rating is pulled: the league mean (0), or last season's rating shrunk by rho. With
    `groups`, that pull is to the team's group mean plus `prior_mean` (last season's gap from its group, shrunk by rho)."""
    ratings, home_field, log_sigma, means = unpack(params, groups)
    n = len(ratings)
    center_log_sigma, sd_log_sigma = sigma_prior or (LOG_SIGMA_PRIOR, LOG_SIGMA_PRIOR_SD)
    sigma = np.exp(np.clip(log_sigma, -30.0, 30.0))  # a runaway first step must not overflow
    mu = ratings[g.home] - ratings[g.away] + home_field * g.edge
    pull = np.zeros(n) if groups is None else means[groups.index]
    gap = ratings - pull - prior_mean  # how far each rating sits from what its prior expects

    normal = ~g.censored
    upper = g.censored & (g.margin > 0)
    lower = g.censored & (g.margin < 0)
    z_normal = np.clip((g.margin[normal] - mu[normal]) / sigma, -Z_CLIP, Z_CLIP)
    z_upper = np.clip((CAP - mu[upper]) / sigma, -Z_CLIP, Z_CLIP)
    z_lower = np.clip((-CAP - mu[lower]) / sigma, -Z_CLIP, Z_CLIP)

    value = (
        (0.5 * z_normal**2 + log_sigma).sum()
        - norm.logsf(z_upper).sum()
        - norm.logcdf(z_lower).sum()
        + (gap**2).sum() / (2 * tau**2)
        + (log_sigma - center_log_sigma) ** 2 / (2 * sd_log_sigma**2)
    )
    if groups is not None:
        value += ((means - groups.center) ** 2).sum() / (2 * groups.sd**2)

    hazard_upper = np.exp(norm.logpdf(z_upper) - norm.logsf(z_upper))
    hazard_lower = np.exp(norm.logpdf(z_lower) - norm.logcdf(z_lower))
    d_mu = np.zeros(len(mu))
    d_mu[normal] = -z_normal / sigma
    d_mu[upper] = -hazard_upper / sigma
    d_mu[lower] = hazard_lower / sigma

    gradient = np.zeros(len(params))
    np.add.at(gradient, g.home, d_mu)
    np.subtract.at(gradient, g.away, d_mu)
    gradient[:n] += gap / tau**2
    gradient[n] = (d_mu * g.edge).sum()
    gradient[n + 1] = (
        (1 - z_normal**2).sum()
        - (hazard_upper * z_upper).sum()
        + (hazard_lower * z_lower).sum()
        + (log_sigma - center_log_sigma) / sd_log_sigma**2
    )
    if groups is not None:
        np.subtract.at(gradient, n + 2 + groups.index, gap / tau**2)
        gradient[n + 2 :] += (means - groups.center) / groups.sd**2
    return float(value), gradient


def converged(result, gradient_floor: float = 1e-3, sigma_index: int | None = None) -> bool:
    """True when L-BFGS-B stopped at a stationary point: a near-zero gradient. Its own success flag is not enough, because
    the relative-reduction test can fire far from the optimum (2025 games through Sept 28, cold start: the first step,
    taken on a huge gradient, left the finite region, the line search shrank to nothing, and the search "succeeded" at
    sigma 61 with a gradient of 171; the optimum is sigma 18.9). With ftol=1e-15 it can also stop ABNORMAL at the optimum
    when the line search runs out of float precision (seen on Linux CI, Nov 10, 2026)."""
    if not (result.success or "ABNORMAL" in str(result.message)):
        return False
    jac = np.array(result.jac, dtype=float)
    if sigma_index is not None and result.x[sigma_index] <= np.log(SIGMA_FLOOR) + 1e-9 and jac[sigma_index] > 0:
        jac[sigma_index] = 0.0  # resting on the sigma floor, pushing against it: stationary for the bounded problem
    return float(np.max(np.abs(jac))) < gradient_floor


def fit(
    g: Games,
    n_teams: int,
    tau: float = 30.0,
    censor: bool = True,
    prior_mean: np.ndarray | float = 0.0,
    start: Fit | None = None,
    groups: Groups | None = None,
    sigma_prior: tuple[float, float] | None = None,
) -> Fit:
    """MAP fit. `prior_mean` (one value per team) is the season prior of plan section 8.2: rho * last season's rating.
    `start` (an earlier fit of the same teams) only speeds the search: the optimum is the same from any start."""
    data = g if censor else replace(g, censored=np.zeros(len(g.margin), dtype=bool))
    k = len(groups) if groups is not None else 0
    x0 = np.zeros(n_teams + 2 + k)
    x0[n_teams + 1] = (sigma_prior or (LOG_SIGMA_PRIOR, 0))[0]
    if groups is not None:
        x0[n_teams + 2 :] = groups.center
    if start is not None:
        x0 = start_vector(start, n_teams, groups, x0)
    # Tight tolerances: with scipy's defaults a full season stopped up to 1.5 points short, and two machines published
    # different tables. These agree to 0.002 points from any start.
    options = {"maxiter": 20000, "ftol": 1e-15, "gtol": 1e-9}
    bounds = [(None, None)] * (n_teams + 1) + [(np.log(SIGMA_FLOOR), None)] + [(None, None)] * k
    x0[n_teams + 1] = max(x0[n_teams + 1], np.log(SIGMA_FLOOR))
    # A search that stops short of a stationary point is restarted from where it stopped, which drops L-BFGS-B's
    # curvature memory and its bad first step; a few restarts reach the optimum.
    for _ in range(MAX_RESTARTS + 1):
        result = minimize(
            neg_log_posterior,
            x0,
            args=(data, tau, prior_mean, groups, sigma_prior),
            jac=True,
            method="L-BFGS-B",
            bounds=bounds,
            options=options,
        )
        if converged(result, sigma_index=n_teams + 1):
            break
        x0 = result.x
    else:
        raise RuntimeError(f"rating fit did not converge: {result.message}")
    return Fit(
        result.x[:n_teams],
        float(result.x[n_teams]),
        float(np.exp(result.x[n_teams + 1])),
        result.x[n_teams + 2 :],
        result.x,
    )


def start_vector(start: Fit, n_teams: int, groups: Groups | None, fallback: np.ndarray) -> np.ndarray:
    means = start.group_means if start.group_means is not None and len(start.group_means) else None
    if groups is not None and means is None:
        means = groups.center
    tail = np.zeros(0) if groups is None else means
    x0 = np.r_[start.ratings, start.home_field, np.log(start.sigma), tail]
    return x0 if len(x0) == len(fallback) else fallback


def objective_of(m: Fit, g: Games, tau: float, prior_mean, groups: Groups | None, sigma_prior) -> float:
    k = len(groups) if groups is not None else 0
    tail = (
        np.zeros(0)
        if groups is None
        else (m.group_means if m.group_means is not None and len(m.group_means) == k else groups.center)
    )
    params = np.r_[m.ratings, m.home_field, np.log(m.sigma), tail]
    return neg_log_posterior(params, g, tau, prior_mean, groups, sigma_prior)[0]


def fit_best(
    g: Games,
    n_teams: int,
    tau: float = 30.0,
    prior_mean: np.ndarray | float = 0.0,
    start: Fit | None = None,
    groups: Groups | None = None,
    sigma_prior: tuple[float, float] | None = None,
) -> Fit:
    """`fit` from two starts (the prior mean, which is the plain cold start when the prior is the league mean, and
    `start`), keeping the lowest objective. `fit` now restarts a search that stops off a stationary point (the cold
    plateau of 2025 games through Sept 28: sigma 61, objective 1244, against 1079), and on every weekly cutoff of 2021
    to 2026 one start matches this; the objective is still not convex in sigma, so the backtest keeps the insurance."""
    prior = np.broadcast_to(np.asarray(prior_mean, dtype=float), (n_teams,))
    center = (sigma_prior or (LOG_SIGMA_PRIOR, 0))[0]
    means = None if groups is None else groups.center.copy()
    starts = [Fit(prior.copy(), 0.0, float(np.exp(center)), means)] + ([start] if start is not None else [])
    fits, failure = [], None
    for s in starts:
        try:
            fits.append(fit(g, n_teams, tau, prior_mean=prior_mean, start=s, groups=groups, sigma_prior=sigma_prior))
        except RuntimeError as e:  # one start may fail to converge; the others still count
            failure = e
    if not fits:
        raise failure
    return min(fits, key=lambda m: objective_of(m, g, tau, prior_mean, groups, sigma_prior))


def rating_sd(
    m: Fit, g: Games, tau: float, prior_mean, groups: Groups | None, sigma_prior, weights: np.ndarray
) -> np.ndarray:
    """Standard deviation of each rating AROUND the weighted average of the rated teams (the centering the site's table
    uses), from the curvature of the posterior at the fit (a Laplace approximation, differencing the exact gradient).
    `weights` (one per team, summing to 1) say whose average the rating is read against."""
    x = m.params
    k = len(groups) if groups is not None else 0
    size = len(x)
    hessian = np.empty((size, size))
    step = 1e-4
    for j in range(size):
        up, down = x.copy(), x.copy()
        up[j] += step
        down[j] -= step
        hessian[:, j] = (
            neg_log_posterior(up, g, tau, prior_mean, groups, sigma_prior)[1]
            - neg_log_posterior(down, g, tau, prior_mean, groups, sigma_prior)[1]
        ) / (2 * step)
    hessian = (hessian + hessian.T) / 2
    cov = np.linalg.inv(hessian + 1e-9 * np.eye(size))
    n = size - 2 - k
    # rating minus the weighted mean of ratings: a linear map of the first n parameters
    centering = np.eye(n) - np.outer(np.ones(n), weights)
    block = centering @ cov[:n, :n] @ centering.T
    return np.sqrt(np.maximum(np.diag(block), 0.0))


def elo(g: Games, n_teams: int, k: float = 32.0, home_points: float = 50.0) -> Fit:
    """Margin-capped Elo, the baseline the model must beat (plan section 8.4). Games must be in date order."""
    r = np.zeros(n_teams)
    diffs = np.zeros(len(g.margin))
    for i in range(len(g.margin)):
        h, a = g.home[i], g.away[i]
        diff = r[h] - r[a] + home_points * g.edge[i]
        diffs[i] = diff
        expected = 1 / (1 + 10 ** (-diff / 400))
        result = 1.0 if g.margin[i] > 0 else 0.0 if g.margin[i] < 0 else 0.5
        change = k * np.log1p(min(abs(g.margin[i]), CAP)) * (result - expected)
        r[h] += change
        r[a] -= change
    slope = float(diffs @ g.margin / max(diffs @ diffs, 1e-9))
    residual = g.margin - slope * diffs
    return Fit(r * slope, home_points * slope, float(max(residual.std(), 1.0)))


def simulate(
    seed: int, n_teams: int = 160, weeks: int = 10, spread: float = 22.0, home: float = 4.0, sigma: float = 17.0
):
    """A season with known truth. Each week pairs teams at random, which mixes teams better than real districts do."""
    rng = np.random.default_rng(seed)
    truth = rng.normal(0, spread, n_teams)
    truth -= truth.mean()
    rows = []
    for week in range(weeks):
        order = rng.permutation(n_teams)
        for h, a in zip(order[::2], order[1::2], strict=False):  # an odd team out sits the week
            latent = round(truth[h] - truth[a] + home + rng.normal(0, sigma))
            if abs(latent) >= CAP:
                recorded = np.sign(latent) * rng.integers(45, 51)
                rows.append((week, h, a, recorded, 1.0, True))
            else:
                rows.append((week, h, a, latent, 1.0, False))
    arr = np.array(rows, dtype=float)
    g = Games(arr[:, 1].astype(int), arr[:, 2].astype(int), arr[:, 3], arr[:, 4], arr[:, 5].astype(bool))
    return g, truth, arr[:, 0].astype(int)


def subset(g: Games, mask: np.ndarray) -> Games:
    return Games(g.home[mask], g.away[mask], g.margin[mask], g.edge[mask], g.censored[mask])
