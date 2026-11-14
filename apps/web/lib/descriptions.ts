import { ordinal } from "./standings";

// The words under a page's title in a search result: each page's own meta description, built from its own data. At most 160
// characters. They say what the page holds and never what a game's result was: no winner is named (ADR 0004), a score never
// appears, and a record or rank may rest on scores the page itself calls unconfirmed (ADR 0013). The only rating words are
// rating, projected margin and win probability, and no source is named (ADR 0010). Organizations never mix (ADR 0012): each
// description names one organization, by the label its pages use.

const MAX = 160;

const count = (n: number, one: string, many = `${one}s`) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);

/** "UIL, TAPPS and TCAF". */
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The sentences in order, each kept only if it still fits in 160 characters. A sentence may be a list of wordings, longest
 * first: the first that fits is used; an empty one is skipped. The first sentence always stays (its shortest wording,
 * cut at a word with an ellipsis if even that is too long). */
function fit(first: string | string[], ...more: (string | string[])[]): string {
  const starts = [first].flat();
  let text = starts.find((s) => s.length <= MAX) ?? `${starts.at(-1)!.slice(0, MAX - 1).replace(/\s+\S*$/, "")}…`;
  for (const option of more) {
    const next = [option].flat().find((s) => s && `${text} ${s}`.length <= MAX);
    if (next) text = `${text} ${next}`;
  }
  return text;
}

export const homeDescription = (season: number, orgs: string[]) =>
  fit(`Texas six-man football for ${season}: scores, rankings, playoff brackets and standings for ${list(orgs)}.`, [
    "Every program, a rating for every team, and the state championship archive.",
    "Every program and every state final.",
  ]);

export const scoresDescription = (season: number) =>
  fit(`The ${season} Texas six-man playoff scoreboard, one organization at a time.`, [
    "Every bracket game, with a projected margin and win probability for each game still to play.",
    "Every bracket game, with projections for games still to play.",
  ]);

export const matchupDescription = (season: number) =>
  fit(`Compare any two rated Texas six-man teams, at home or on a neutral field.`, [
    `The ${season} projected margin and win probability, from the ratings.`,
    "The projected margin and win probability.",
  ]);

export const programsDescription = (programs: number, orgs: string[]) =>
  fit(`Find any of ${programs} Texas six-man programs across ${list(orgs)}.`, [
    "Each school's rank, record, schedule, rating and state titles.",
    "Each school's rank, record and schedule.",
  ]);

export const championshipsDescription = ({ first, latest, games }: { first?: number; latest?: number; games: number }) =>
  fit(
    first === undefined
      ? "Every UIL six-man state championship game."
      : `Every UIL six-man state championship game, ${first} to ${latest}: ${count(games, "final")}.`,
    ["Division I and Division II since 2006, and the programs with the most state titles.", "The programs with the most state titles."],
  );

export const howRankingsDescription = () =>
  fit("How the six-man ratings work: one rating per team fitted to every score, how the 45-point rule counts, and how well past seasons' ratings fit.", [
    "How the ratings work, and how well past seasons' ratings fit.",
  ]);

/** A view of the rankings: `label` is "UIL", "UIL Division I", "TAPPS"... `past` is a season already over. */
export function rankingsDescription({ label, season, games, past }: { label: string; season: number; games: number; past: boolean }) {
  const base = `${label} six-man rankings for ${season}`;
  const all = `rated on all ${games.toLocaleString("en-US")} games of the season`;
  return past
    ? fit(`${base}, final: every team's rating, rank and record, ${all}.`, `${base}, final: every team's rating, rank and record.`)
    : fit(`${base}: every team's rating, rank, record and weekly movement, ${all}.`, `${base}: every team's rating, rank, record and weekly movement.`);
}

export const rankingsWeekDescription = ({ label, season, week }: { label: string; season: number; week: number }) =>
  fit(`${label} six-man rankings after week ${week} of ${season}: each team's rating, rank and record then, and how far it moved from the week before.`, [
    `${label} six-man rankings after week ${week} of ${season}: each team's rating, rank and record then.`,
  ]);

export function resultsDescription({ org, season, week, games, scope }: { org: string; season: number; week: number; games: number; scope: "latest" | "season" | "week" }) {
  const tail = games === 0 ? [] : ["Each game links to its game page, with a projected margin from the week before where the ratings had one.", "Each game links to its game page."];
  if (scope === "latest") return fit(`Latest ${org} six-man results: ${season} week ${week}, ${count(games, "game")}.`, tail);
  if (scope === "season") return fit(`${org} six-man results for ${season}, opening on its last week, week ${week}: ${count(games, "game")}.`, "Every earlier week is one tap away.");
  return fit(`${org} ${season} week ${week} six-man results: ${count(games, "game")}.`, tail);
}

export function standingsDescription({ label, season, teams, groups, districtPlay }: { label: string; season: number; teams: number; groups: number; districtPlay: boolean }) {
  return districtPlay
    ? fit(`${label} six-man standings for ${season}: ${count(teams, "team")} in ${count(groups, "district")}.`, [
        "District records, overall records and point difference.",
        "District and overall records.",
      ])
    : fit(`${label} six-man standings for ${season}: ${count(teams, "team")} in ${count(groups, "group")}, by division and region.`, [
        "Overall records and point difference.",
        "Overall records.",
      ]);
}

/** One league's playoffs, the latest season or a past one: `brackets` is how many it had. */
export function playoffsDescription({ league, season, brackets, past }: { league: string; season: number; brackets: number; past: boolean }) {
  const base = `${season} ${league} six-man playoffs: ${count(brackets, "bracket")}`;
  return past
    ? fit(`${base}, every game of the postseason, round by round.`)
    : fit(`${base}, round by round.`, ["Projected margins and win probabilities for games still to play, and each team's chance at a title.", "Projected margins and win probabilities for games still to play."]);
}

export const bracketDescription = ({ name, season, latestRound }: { name: string; season: number; latestRound?: string }) =>
  fit(`${name} ${season} six-man playoff bracket${latestRound ? `, latest round: ${latestRound}` : ""}.`, [
    "Every round's games, with projected margins and win probabilities for games still to play.",
    "Every round's games, with projections for games still to play.",
  ]);

export function recordsDescription({ org, first, latest }: { org: string; first?: number; latest?: number }) {
  const span = first === undefined ? "" : first === latest ? ` for ${first}` : `, ${first} to ${latest}`;
  return fit(`${org} six-man records${span}: most points in a game, most by both teams, biggest upsets, longest streaks and unbeaten seasons.`, [
    `${org} six-man records${span}: most points in a game, biggest upsets, longest streaks and unbeaten seasons.`,
  ]);
}

const REVIEW = ["Rating movers, results furthest from the projection, closest games, biggest margins and playoff advancement.", "Rating movers, closest games, biggest margins and playoff advancement."];

export const weeksIndexDescription = ({ org, first, latest }: { org: string; first?: number; latest?: number }) =>
  fit(`${org} six-man week in review${first === undefined ? "" : first === latest ? ` for ${first}` : `, ${first} to ${latest}`}.`, ["Each week of every season, with its rating movers and closest games.", ...REVIEW]);

export const weekReviewDescription = ({ org, season, week, games }: { org: string; season: number; week: number; games: number }) =>
  fit(`${org} six-man ${season} week ${week} in review: ${count(games, "game")}.`, REVIEW);

/** "#3 in Division II" (UIL six-man's own divisions), "#1 in TAPPS" or "Not ranked": the text `rankLabel` gives a program page, in words. */
export function rankPhrase(text: string): string {
  const found = /^#(\d+) in (.+)$/.exec(text);
  if (!found) return "not yet ranked";
  return `${ordinal(Number(found[1]))} in ${found[2].startsWith("Division") ? `UIL ${found[2]}` : found[2]}`;
}

type ProgramFacts = {
  name: string;
  /** "UIL Division II", "TAPPS Division I": the heading its alignment sits under. */
  group: string;
  /** "Region 2 · District 5" or "District 3"; empty for a league with no districts. */
  place: string;
  season: number;
  /** The first season the page has history for. */
  since: number;
  /** UIL state titles, merged schools' included. */
  titles: number;
  /** This season's record ("9-1") and `rankPhrase` text; absent for a team with no game on record. */
  team?: { record: string; rank: string };
};

export function programDescription({ name, group, place, season, since, titles, team }: ProgramFacts) {
  const lead = team ? `${name} six-man football: ${season} record ${team.record}, ${team.rank}.` : `${name} six-man football in ${group}.`;
  return fit(
    lead,
    titles ? `${count(titles, "UIL state title")}.` : "",
    /^(Region|District) /.test(place) ? `${place.replace(" · ", ", ")}.` : "",
    [`Schedule, scores, ratings and playoff history since ${since}.`, "Schedule, scores, ratings and playoff history."],
  );
}

type ProgramSeasonFacts = {
  name: string;
  season: number;
  /** Games read for the school that season. */
  games: number;
  /** The season's record ("12-2"), counting playoffs; absent when the data has none. */
  record?: string;
  /** Its place among its organization's teams: "UIL" with place 3; absent for a team with too few games to be ranked. */
  rank?: { place: number; org: string };
  /** The last playoff round it played, as a phrase: "the state final". */
  playoff?: string;
};

/** A program's page for one season: the record and rank, the playoff round it reached and what the page lists. No score and no winner. */
export function programSeasonDescription({ name, season, games, record, rank, playoff }: ProgramSeasonFacts) {
  const lead = record ? `${name} ${season} six-man football: ${record}${rank ? `, ${ordinal(rank.place)} in ${rank.org}` : ""}.` : `${name} ${season} six-man football: ${count(games, "game")}.`;
  return fit(
    [lead, `${name} ${season} six-man football.`],
    playoff ? `Playoffs: reached ${playoff}.` : "",
    ["Every game, with its date, opponent and a projected margin.", "Every game, with its date and opponent.", "Every game of the season."],
  );
}

type GameFacts = {
  away: string;
  home: string;
  /** "Oct 24, 2025", or nothing for a game with no date. */
  date?: string;
  season: number;
  /** "UIL DI · Bi-district", "TAIAO D1 · Quarterfinal" or "TAPPS Division II · Quarterfinal" for a playoff game. */
  playoff?: string;
  /** A game still to be played. */
  scheduled: boolean;
  /** An invented game on the sample scoreboard. */
  sample?: boolean;
};

/** A game's page, with no score and no winner: the teams, the date and the round, and what the page adds. */
export function gameDescription({ away, home, date, season, playoff, scheduled, sample }: GameFacts) {
  if (sample) return fit(`A sample six-man game between invented schools: ${away} vs ${home}.`, "It shows how the scoreboard reads.");
  const [group, round] = (playoff ?? "").split(" · ");
  const kind = playoff
    ? `${season} ${group.replace(/\bD(I+|\d+)\b/, "Division $1")}${round ? ` ${round.toLowerCase()}` : ""} playoff game`
    : `${season} season game`;
  const teams = `${away} vs ${home}`;
  return fit(
    [`${teams}${date ? `, ${date}` : ""}: ${kind}.`, `${teams}${date ? `, ${date}` : ""}.`, `${teams}.`],
    scheduled
      ? ["A preview with each team's record and rating, and the projected margin and win probability.", "A preview with each team's record and rating."]
      : ["Each team's record going in and their earlier meetings.", "Their earlier meetings."],
  );
}

type SeriesFacts = {
  first: string;
  second: string;
  /** Games the two programs played in the seasons read. */
  games: number;
  /** The first season read. */
  since: number;
  /** At least one of the games was a playoff game. */
  playoff: boolean;
  /** Both teams are rated, so the page projects a game between them. */
  projection: boolean;
};

/** A series page (two programs' games since FIRST_SEASON): how many meetings, and what the page lists. No score and no winner. */
export function seriesDescription({ first, second, games, since, playoff, projection }: SeriesFacts) {
  const teams = `${first} vs ${second}`;
  const what = playoff ? "Every score and playoff game" : "Every score";
  return fit(
    [`${teams} six-man football: ${count(games, "meeting")} since ${since}.`, `${teams}: ${count(games, "meeting")} since ${since}.`, `${teams}.`],
    projection ? [`${what}, and a projection if they met now.`, `${what}.`] : `${what}.`,
  );
}
