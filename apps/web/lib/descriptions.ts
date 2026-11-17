import { ordinal } from "./standings";

// The words under a page's title in a search result: each page's own meta description, built from its own data. At most 160
// characters. They say what the page holds and never what a game's result was: no winner is named (ADR 0004), a score never
// appears, and a record or rank may rest on scores the page itself calls unconfirmed (ADR 0013). The only rating words are
// rating, projected margin and chance to win, and no source is named (ADR 0010). Organizations never mix (ADR 0012): each
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
    "Every program, a rating for every team, and the State Championship archive.",
    "Every program and every State Championship.",
  ]);

/** The landing page (/welcome, ADR 0086). */
export const welcomeDescription = (programs: number, orgs: string[]) =>
  fit(`Every Texas six-man football team and game, free: ${programs} programs in ${list(orgs)}.`, [
    "Live scores, rankings with each team's chance to win, playoff brackets, program histories and every State Championship.",
    "Live scores, rankings, playoff brackets and every State Championship.",
  ]);

export const scoresDescription = (season: number) =>
  fit(`The ${season} Texas six-man playoff scoreboard, one organization at a time.`, [
    "Every bracket game, with a projected margin and chance to win for each game still to play.",
    "Every bracket game, with projections for games still to play.",
  ]);

export const matchupDescription = (season: number) =>
  fit(`Compare any two rated Texas six-man teams, at home or on a neutral field.`, [
    `The ${season} projected margin and chance to win, from the ratings.`,
    "The projected margin and chance to win.",
  ]);

export const programsDescription = (programs: number, orgs: string[]) =>
  fit(`Find any of ${programs} Texas six-man programs across ${list(orgs)}.`, [
    "Each school's rank, record, schedule, rating and state titles.",
    "Each school's rank, record and schedule.",
  ]);

export const championshipsDescription = ({ first, latest, games }: { first?: number; latest?: number; games: number }) =>
  fit(
    first === undefined
      ? "Every UIL six-man State Championship game."
      : `Every UIL six-man State Championship game, ${first} to ${latest}: ${count(games, "State Championship game")}.`,
    ["Division I and Division II since 2006, and the programs with the most state titles.", "The programs with the most state titles."],
  );

/** One year's State Championship: each game's two schools in alphabetical order (no winner in a description), `games` one per division. */
export const championshipYearDescription = ({ year, games }: { year: number; games: { division: string; teams: [string, string] }[] }) => {
  const pairs = games.map((g) => ({ division: g.division, text: [...g.teams].sort((a, b) => a.localeCompare(b)).join(" and ") }));
  const named = pairs.map((p) => (p.division ? `Division ${p.division}, ${p.text}` : p.text)).join("; ");
  const many = games.length > 1;
  return fit(
    [`The ${year} UIL six-man State Championship ${many ? "games" : "game"}: ${named}.`, `The ${year} UIL six-man State Championship ${many ? "games in Division I and Division II" : "game"}.`],
    [`The champion, runner-up and score${many ? " of each" : ""}, with each school's page.`, `The champion, runner-up and score${many ? " of each" : ""}.`],
  );
};

export const aboutRatingsDescription = () =>
  fit("What a six-man rating means: points better than an average team, the ± and rank range, games rated, the 45-point rule and forfeits.", [
    "What a six-man rating means and which games it rests on.",
  ]);

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

/** One district's page: its standings and every district game's score. `label` is "UIL Division I District 8". */
export function districtStandingsDescription({ label, season, teams, games }: { label: string; season: number; teams: number; games: number }) {
  return fit(`${label} six-man standings for ${season}: ${count(teams, "team")}, ${count(games, "district game")} played.`, [
    "District records, overall records, point difference and every district game.",
    "District and overall records and every district game.",
    "District and overall records.",
  ]);
}

/** One league's playoffs, the latest season or a past one: `brackets` is how many it had. */
export function playoffsDescription({ league, season, brackets, past }: { league: string; season: number; brackets: number; past: boolean }) {
  const base = `${season} ${league} six-man playoffs: ${count(brackets, "bracket")}`;
  return past
    ? fit(`${base}, every game of the postseason, round by round.`)
    : fit(`${base}, round by round.`, ["Projected margins and chances to win for games still to play, and each team's chance at a title.", "Projected margins and chances to win for games still to play."]);
}

export const bracketDescription = ({ name, season, latestRound }: { name: string; season: number; latestRound?: string }) =>
  fit(`${name} ${season} six-man playoff bracket${latestRound ? `, latest round: ${latestRound}` : ""}.`, [
    "Every round's games, with projected margins and chances to win for games still to play.",
    "Every round's games, with projections for games still to play.",
  ]);

export function recordsDescription({ org, first, latest }: { org: string; first?: number; latest?: number }) {
  const span = first === undefined ? "" : first === latest ? ` for ${first}` : `, ${first} to ${latest}`;
  return fit(`${org} six-man records${span}: most points in a game, most by both teams, biggest surprises, longest streaks and unbeaten seasons.`, [
    `${org} six-man records${span}: most points in a game, biggest surprises, longest streaks and unbeaten seasons.`,
  ]);
}

/** One view's scoring leaders for a season (/leaders): `label` is "UIL", "UIL Division I", "TAPPS"... */
export const leadersDescription = ({ label, season }: { label: string; season: number }) =>
  fit(`${label} six-man scoring leaders for ${season}: points per game, points allowed, shutouts and 60-point games.`, "Final scores only.");

const REVIEW = ["Upsets, biggest wins, closest games, streaks, milestones, rating movers and playoff advancement.", "Upsets, biggest wins, closest games, streaks and milestones.", "Upsets, biggest wins and closest games."];

export const weeksIndexDescription = ({ org, first, latest }: { org: string; first?: number; latest?: number }) =>
  fit(`${org} six-man week in review${first === undefined ? "" : first === latest ? ` for ${first}` : `, ${first} to ${latest}`}.`, ["Each week of every season, with its upsets, closest games and rating movers.", ...REVIEW]);

export const weekReviewDescription = ({ org, season, week, games }: { org: string; season: number; week: number; games: number }) =>
  fit(`${org} six-man ${season} week ${week} in review: ${count(games, "game")}.`, REVIEW);

/** One season's hub page: how many games were read, across which organizations, and what the page holds. `past`: the season is over. */
export const seasonDescription = ({ season, games, orgs, past }: { season: number; games: number; orgs: string[]; past: boolean }) =>
  fit(`${season} Texas six-man football season: ${games.toLocaleString("en-US")} ${games === 1 ? "game" : "games"} across ${list(orgs)}.`, [
    past ? "State Championships, final rankings, team leaders and every week of results." : "Rankings so far, team leaders and every week of results.",
    "Rankings, team leaders and every week of results.",
  ]);

export const seasonsIndexDescription = ({ first, latest }: { first?: number; latest?: number }) =>
  fit(first === undefined ? "Every Texas six-man football season on this site." : `Every Texas six-man football season on this site, ${first} to ${latest}.`, [
    "Each season's State Championships, rankings, team leaders and week-by-week results.",
    "Each season's rankings, team leaders and results.",
  ]);

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
  /** The last playoff round it played, as a phrase: "the State Championship". */
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
    ? `${season} ${group.replace(/\bD(I+|\d+)\b/, "Division $1")}${round ? ` ${round === "State Championship" ? round : round.toLowerCase()}` : ""} playoff game`
    : `${season} season game`;
  const teams = `${away} vs ${home}`;
  return fit(
    [`${teams}${date ? `, ${date}` : ""}: ${kind}.`, `${teams}${date ? `, ${date}` : ""}.`, `${teams}.`],
    scheduled
      ? ["A preview with each team's record and rating, and the projected margin and chance to win.", "A preview with each team's record and rating."]
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

/** One league bracket's State Championship page: the two teams when known, the date, and what the page holds. No score and no
 * winner, as every description (the page names the champion once the game is recorded). */
export function stateChampionshipDescription({ season, bracket, teams, date, played }: { season: number; bracket: string; teams: string[]; date?: string; played: boolean }) {
  const matchup = teams.length === 2 ? `${teams[0]} vs ${teams[1]}` : undefined;
  const when = date ? `, ${date}` : "";
  return fit(
    matchup
      ? [`The ${season} ${bracket} State Championship${when}: ${matchup}.`, `The ${season} ${bracket} State Championship: ${matchup}.`, `The ${season} ${bracket} State Championship.`]
      : [`The ${season} ${bracket} State Championship${when}.`, `The ${season} ${bracket} State Championship.`],
    played
      ? ["The result, each team's playoff path, season record and State Championship history.", "The result, each team's playoff path and history."]
      : ["The kickoff and site, each team's playoff path and season record, and the projected margin and chance to win.", "The kickoff, site, playoff paths and the projected margin and chance to win."],
  );
}
