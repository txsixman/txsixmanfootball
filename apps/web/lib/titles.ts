// A page's <title>: the line a search result shows in blue, so it leads with the words fans type ("Jayton football",
// "six-man playoff bracket 2026", "Jayton vs Kress score"). The layout adds " | TX Six-Man Football" after it. Each title
// here is at most 60 characters, the first wording that fits, and says what the page holds, never a result: no winner and
// no score (ADR 0004), no betting word, no source named (ADR 0010), one organization at a time (ADR 0012).

const MAX = 60;

/** The first wording that fits in 60 characters, else the last one cut at a word. */
function fit(...options: string[]): string {
  return options.find((t) => t.length <= MAX) ?? `${options.at(-1)!.slice(0, MAX - 1).replace(/\s+\S*$/, "")}…`;
}

/** The home page's whole title (the layout's suffix is not added, so the site's name leads). */
export const homeTitle = () => "TX Six-Man Football: Texas six-man scores, brackets, rankings";

export const scoresTitle = (season: number) => fit(`Texas six-man football scores: ${season} playoffs`, "Texas six-man football scores");

export const tonightTitle = () => "Six-man football scores tonight, live";

/** A league's playoffs page: the latest season, or a past one (`past`). UIL's has Division I and II. */
export function playoffsTitle({ league, season, past }: { league: string; season: number; past: boolean }) {
  if (past) return fit(`${season} ${league} six-man playoffs: every bracket and score`, `${season} ${league} six-man playoffs`);
  return league === "UIL"
    ? `${season} UIL six-man playoffs: Division I and II brackets`
    : fit(`${season} ${league} six-man playoffs: brackets and scores`, `${season} ${league} six-man playoff brackets`);
}

/** One bracket: `name` is "UIL Division I", "TAPPS Division II"... */
export const bracketTitle = ({ name, season }: { name: string; season: number }) =>
  fit(`${season} ${name} six-man playoff bracket`, `${name} six-man playoff bracket`, `${name} playoff bracket`);

/** "Jayton Jaybirds" from the school and its mascot, unless the name already ends with it ("Fort Bend Chargers"). */
const schoolAndMascot = (name: string, mascot?: string | null) =>
  !mascot || name.toLowerCase().endsWith(mascot.toLowerCase()) ? name : `${name} ${mascot}`;

export function programTitle({ name, mascot, season }: { name: string; mascot?: string | null; season: number }) {
  const full = schoolAndMascot(name, mascot);
  return fit(
    `${full} football: ${season} schedule, scores, ranking`,
    `${full} football: ${season} scores and schedule`,
    `${name} football: ${season} scores and schedule`,
    `${name} football: ${season} scores`,
    `${name} football`,
  );
}

export const programSeasonTitle = ({ name, mascot, season }: { name: string; mascot?: string | null; season: number }) =>
  fit(`${schoolAndMascot(name, mascot)} football ${season}: schedule and scores`, `${name} football ${season}: schedule and scores`, `${name} football ${season}`);

/** "UIL Division I bi-district" from a bracket label ("UIL DI · Bi-district", "TAIAO D1 · First round"). */
const roundWords = (label: string) => {
  const [group, round] = label.split(" · ");
  return `${group.replace(/\bD(I+|\d+)\b/, "Division $1")}${round ? ` ${round.toLowerCase()}` : ""}`;
};

/**
 * A game. A played final: both schools and the score, away team first as on every page, then the round and season for a
 * playoff game or the date ("Kress 6, Jayton 75 · UIL Division I bi-district 2026"). The order is the page's, so the
 * title never says who won. A forfeit has no score; it and a game not yet final read "Kress vs Jayton football score, Nov
 * 13, 2026"; a game still to play is a preview. `date` is already formatted; `round` is a bracket label.
 */
export function gameTitle({ away, home, date, scheduled, final, round, season }: { away: string; home: string; date?: string; scheduled: boolean; final?: { away: number; home: number }; round?: string; season?: number }) {
  const teams = `${away} vs ${home}`;
  const when = date ? `, ${date}` : "";
  if (final) {
    const score = `${away} ${final.away}, ${home} ${final.home}`;
    const tail = round ? `${roundWords(round)}${season ? ` ${season}` : ""}` : (date ?? "");
    return fit(...[tail && `${score} · ${tail}`, date && `${score} · ${date}`, score].filter((t): t is string => Boolean(t)));
  }
  return scheduled
    ? fit(`${teams} football preview${when}`, `${teams}${when}`, teams)
    : fit(`${teams} football score${when}`, `${teams} score${when}`, `${teams}${when}`, teams);
}

export const seriesTitle = ({ first, second }: { first: string; second: string }) =>
  fit(`${first} vs ${second} football: every meeting`, `${first} vs ${second} football`, `${first} vs ${second}`);

/** `label` is "UIL", "UIL Division I", "TAPPS"... `week` for a table at the end of a week. */
export function rankingsTitle({ label, season, week }: { label: string; season: number; week?: number }) {
  if (week !== undefined) return fit(`${label} six-man rankings after week ${week}, ${season}`, `${label} rankings after week ${week}, ${season}`);
  return fit(`${season} ${label} six-man football rankings`, `${season} ${label} six-man rankings`);
}

export const standingsTitle = ({ label, season }: { label: string; season: number }) =>
  fit(`${season} ${label} six-man football standings`, `${season} ${label} six-man standings`);

/** The latest week's results, a season's, or one week's. */
export const resultsTitle = ({ label, season, week, scope }: { label: string; season: number; week: number; scope: "latest" | "season" | "week" }) =>
  scope === "week"
    ? fit(`${label} six-man football scores: ${season} week ${week}`, `${label} six-man scores, ${season} week ${week}`)
    : scope === "season"
      ? fit(`${label} six-man football scores, ${season} season`, `${label} six-man scores, ${season}`)
      : fit(`${label} six-man football scores this week`, `${label} six-man scores this week`);

export const recordsTitle = (label: string) => fit(`${label} six-man football records`, `${label} records`);

export const championshipsTitle = ({ first, latest }: { first?: number; latest?: number }) =>
  first === undefined ? "UIL six-man state champions" : `UIL six-man state champions, ${first} to ${latest}`;

export const programsTitle = () => "Texas six-man football teams: every program";

export const matchupTitle = () => "Six-man matchup: any two teams, projected margin";
