// What the weekly digest says about one team (ADR 0055), worked out from the repo's own data files: last week's confirmed result,
// the team's ranking move, and its next game with the chance to win. Pure: `files` reads the repo, `today` is the Central date
// the digest goes out ("YYYY-MM-DD"). Public facts only; who gets a digest is the database's call (email_pending_digests).
//
// Three small rules are copies of the site's, because lib/*.ts imports each other without file extensions and plain Node
// (which this job runs under) cannot load them. apps/web/scripts/email-digest-parity.test.mjs runs both on the real data and
// fails if they ever disagree:
//   - rank and ranking move: lib/rank-range.ts placeRows and lib/ratings.ts movement, on the trend column of a week the way
//     lib/week-rankings.ts reads it, within one group the way lib/rankings.ts counts (UIL six-man division, else organization);
//   - the chance to win: lib/projection.ts project, homeWinProbability, chanceText.
import { forfeitScore } from "../../apps/web/lib/forfeit.ts";
import { slugify } from "../../apps/web/lib/slug.ts";
import { csvRows, gameKey, scored } from "./events.mjs";

/** Fewer rated games than this and a team takes no rank (lib/ratings.ts FEW_GAMES). */
export const FEW_GAMES = 4;
/** A rating must move more than this many points before a rank move counts (lib/ratings.ts MOVE_THRESHOLD). */
export const MOVE_THRESHOLD = 4;

// ---- dates (Central time, as every page counts a game night) --------------------------------------------------------------
const DAY = 86_400_000;
const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date, n) => iso(at(date) + n * DAY);
/** The Monday on or before a date. */
export const mondayOf = (date) => addDays(date, -((new Date(at(date)).getUTCDay() + 6) % 7));
/** Today's date in Central time. */
export const centralDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
/** "2026-w47": the ISO week of a date (the week's Thursday decides the year). */
export function isoWeek(date) {
  const thursday = at(addDays(mondayOf(date), 3));
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1, 12)) / (7 * DAY)) + 1;
  return `${year}-w${String(week).padStart(2, "0")}`;
}
/** The digest goes out on a Monday, and a run that was late or is repeated may still send until the end of Wednesday; after that the
 * "last week" it would describe is stale. */
export const sendWindowOpen = (date) => [1, 2, 3].includes(new Date(at(date)).getUTCDay());

// ---- the chance to win (lib/projection.ts) ----------------------------------------------------------------------------------
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
/** P(the home side wins) for the table's current ratings, or undefined for a team unrated or a table without the fit. */
export function homeChance(table, home, away, neutral, trueNeutral = false) {
  if (table.sigma == null || table.home_field == null) return undefined;
  const rating = new Map(table.teams.map((t) => [slugify(t.team), t.rating]));
  const h = rating.get(slugify(home));
  const a = rating.get(slugify(away));
  if (h == null || a == null) return undefined;
  const edge = neutral ? (trueNeutral ? 0 : table.home_field * (table.playoff_edge ?? 0)) : table.home_field;
  const margin = h - a + edge;
  return table.calibration ? 1 / (1 + Math.exp(-margin / table.calibration.scale)) : normalCdf(margin / table.sigma);
}
/** A chance as a percent: never 100% or 0%. */
export const chanceText = (p) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

// ---- rank and ranking move (lib/rank-range.ts, lib/ratings.ts, lib/rankings.ts) ----------------------------------------------
/** Best first, ties by name. */
const byRating = (a, b) => b.rating - a.rating || a.team.localeCompare(b.team);

/** One group's table at one trend column: each ranked team's place, and its move since the column before (a number of places,
 * 0 when its rating moved by MOVE_THRESHOLD or less, "new" when unrated before; undefined for the first column). */
export function groupWeek(table, inGroup, index) {
  const rows = table.teams
    .filter((t) => t.trend?.[index] != null && inGroup(t.team))
    .map((t) => ({ team: t.team, rating: t.trend[index], was: index > 0 ? (t.trend[index - 1] ?? null) : undefined, rated: t.rated_trend?.[index] ?? 0 }));
  const ranked = rows.filter((r) => r.rated >= FEW_GAMES).sort(byRating);
  const place = new Map(ranked.map((r, i) => [r.team, i + 1]));
  const moved = new Map();
  if (ranked.some((r) => r.was !== undefined)) {
    const before = ranked.filter((r) => r.was != null).sort((a, b) => b.was - a.was || a.team.localeCompare(b.team));
    const placeBefore = new Map(before.map((r, i) => [r.team, i + 1]));
    ranked.forEach((r, i) => moved.set(r.team, !placeBefore.has(r.team) ? "new" : Math.abs(r.rating - r.was) > MOVE_THRESHOLD ? placeBefore.get(r.team) - (i + 1) : 0));
  }
  return { place, moved, rated: new Set(rows.map((r) => r.team)) };
}

// ---- the data ---------------------------------------------------------------------------------------------------------------
/** The newest alignment folder of each league family, as lib/alignments.ts reads them: uil-2026-28, tapps-2026-28, private-2026. */
function alignmentRows(files) {
  const dirs = files.list("data/seed");
  const newest = (re) => dirs.filter((d) => re.test(d)).sort().at(-1);
  return [newest(/^uil-\d{4}-\d{2}$/), newest(/^tapps-\d{4}-\d{2}$/), newest(/^private-\d{4}$/)]
    .filter(Boolean)
    .flatMap((d) => csvRows(files.read(`data/seed/${d}/alignments.csv`)));
}

/** "Division I" for a UIL six-man school, else the organization (lib/rankings.ts). */
const groupOf = (a) => (a.league === "UIL" && (a.division === "I" || a.division === "II") ? { league: "UIL", division: a.division, label: `Division ${a.division}` } : { league: a.league, label: a.league });

const titleCase = (slug) => slug.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");

/**
 * Everything the digest needs, read once: `forTeam(slug)` gives that team's section. `events` are the game events of events.mjs
 * (their next-round games are used when no dated game is listed yet).
 */
export function digestData({ season, today, files, events = [] }) {
  const seed = (...p) => ["data/seed", ...p].join("/");
  const monday = mondayOf(today);
  const [from, to] = [addDays(monday, -7), addDays(monday, -1)]; // last week: Monday to Sunday
  const table = (() => {
    const text = files.read(`data/ratings/${season}.json`);
    return text ? JSON.parse(text) : { teams: [] };
  })();
  const column = (table.weeks ?? []).indexOf(to);
  const results = (name) => csvRows(files.read(seed(`maxpreps-${season}`, name)));
  const disputed = new Set(csvRows(files.read(seed("disputed", `${season}.csv`))).map((r) => gameKey(r.game_date, r.home, r.away)));
  const kickoffs = new Map(csvRows(files.read(seed("game-details", `${season}.csv`))).map((r) => [gameKey(r.date, r.home, r.away), r.kickoff_utc]));

  // Every game of the season once: a hand-captured playoff game wins over a robot row for the same game (lib/games.ts).
  const hand = files.list("data/seed").filter((d) => /^uil-\d{4}-\d{2}$/.test(d)).flatMap((d) => csvRows(files.read(seed(d, `playoffs-${season}.csv`))));
  const seen = new Set();
  const games = [
    ...hand.map((r) => ({ ...r, playoff: true })),
    ...results("playoffs.csv").map((r) => ({ ...r, playoff: true })),
    ...results("games.csv"),
  ].filter((r) => {
    const key = gameKey(r.game_date, r.home, r.away);
    return !seen.has(key) && seen.add(key);
  });

  const alignments = Map.groupBy(alignmentRows(files), (a) => slugify(a.school));
  const groups = new Map(); // "UIL|I" -> the group's table at last week's column, and the week before's
  const rankOf = (slug) => {
    const group = (alignments.get(slug) ?? []).map(groupOf)[0];
    const rated = table.teams.find((t) => slugify(t.team) === slug);
    if (!group || !rated || column < 0 || rated.trend?.[column] == null) return undefined;
    const key = `${group.league}|${group.division ?? ""}`;
    if (!groups.has(key)) {
      const inGroup = (team) => (alignments.get(slugify(team)) ?? []).some((a) => a.league === group.league && (!group.division || a.division === group.division));
      groups.set(key, groupWeek(table, inGroup, column));
    }
    const g = groups.get(key);
    const place = g.place.get(rated.team);
    const moved = g.moved.get(rated.team);
    return { group: group.label, place, moved, before: typeof moved === "number" && moved !== 0 ? place + moved : undefined };
  };

  const involves = (r, slug) => slugify(r.home) === slug || slugify(r.away) === slug;
  const confirmed = (r) => scored(r) && !disputed.has(gameKey(r.game_date, r.home, r.away)) && !forfeitScore(Number(r.home_score), Number(r.away_score));
  const lastOf = (slug) => {
    const week = games.filter((r) => involves(r, slug) && r.game_date >= from && r.game_date <= to).sort((a, b) => a.game_date.localeCompare(b.game_date));
    const final = week.findLast(confirmed);
    if (final) return { kind: "result", date: final.game_date, home: final.home, away: final.away, homeScore: Number(final.home_score), awayScore: Number(final.away_score) };
    return { kind: week.length ? "unconfirmed" : "none" };
  };
  const nextOf = (slug) => {
    const upcoming = games.filter((r) => involves(r, slug) && !scored(r) && r.game_date >= today).sort((a, b) => a.game_date.localeCompare(b.game_date) || a.home.localeCompare(b.home))[0];
    if (upcoming) {
      // A playoff site is neutral unless the file says otherwise, and a listed home team still gets the playoff share of the edge (lib/games.ts).
      const neutral = upcoming.playoff ? upcoming.neutral !== "false" : upcoming.neutral === "true";
      const p = homeChance(table, upcoming.home, upcoming.away, neutral, upcoming.neutral === "true");
      return { date: upcoming.game_date, kickoff: kickoffs.get(gameKey(upcoming.game_date, upcoming.home, upcoming.away)) || undefined, home: upcoming.home, away: upcoming.away, round: upcoming.round || undefined, homeChance: p };
    }
    // No game listed yet, but the bracket gives it both teams (ADR 0047): the round and the teams, the date to come.
    const slot = events.find((e) => e.alert === "next_game" && (e.home_slug === slug || e.away_slug === slug));
    if (!slot) return undefined;
    return { home: slot.home_name, away: slot.away_name, round: slot.round ?? undefined, homeChance: homeChance(table, slot.home_name, slot.away_name, true) };
  };

  return {
    week: { from, to },
    forTeam(slug) {
      const school = (alignments.get(slug) ?? [])[0]?.school;
      const name = school ?? table.teams.find((t) => slugify(t.team) === slug)?.team ?? games.find((r) => slugify(r.home) === slug)?.home ?? games.find((r) => slugify(r.away) === slug)?.away ?? titleCase(slug);
      return { slug, name, last: lastOf(slug), ranking: rankOf(slug), next: nextOf(slug) };
    },
  };
}

/** A fan's digest has something to say only when one of the teams has a confirmed result or a next game: in the off season it
 * has neither, and nothing is sent. A ranking alone is not news. */
export const hasNews = (teams) => teams.some((t) => t.last.kind === "result" || t.next);
