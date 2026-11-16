// The words on the landing page (/welcome, ADR 0084): what the site is, the round being played, and the numbers that show
// how much is here, all from the data the site is built from, never typed in. Pure, no imports: the node tests run it as it
// is. The rules every page keeps hold here too: no winner named (ADR 0004), no source named (ADR 0010), organizations named
// one by one (ADR 0012), the rating words only (rating, projected margin, chance to win), and the last round is the State
// Championship.

/** Set in this browser once it has seen the home page's "New here?" link, dismissed it, or opened /welcome. */
export const WELCOME_SEEN = "welcome-seen";

/**
 * Runs inline on the home page, before the "New here?" link is drawn, so the link is never drawn and then taken away (no
 * layout shift): a browser that has been here before, follows a team (lib/push.ts) or was signed in (lib/account/follows.ts)
 * marks the page `data-returning`, which hides the link. A first visit keeps the link for as long as the page stays open and
 * is marked seen, so the next visit does not show it. Storage that cannot be read shows the link.
 */
export const NEW_HERE_SCRIPT = `try{var s=localStorage,f=JSON.parse(s.getItem("followed-programs")||"[]");if(s.getItem("${WELCOME_SEEN}")||s.getItem("account-hint")==="1"||(Array.isArray(f)&&f.length))document.documentElement.setAttribute("data-returning","");else s.setItem("${WELCOME_SEEN}","1")}catch(e){}`;

/** Runs inline on /welcome: a browser that has opened it is not shown the home page's link again. */
export const WELCOME_SEEN_SCRIPT = `try{localStorage.setItem("${WELCOME_SEEN}","1")}catch(e){}`;

/** "UIL, TAPPS and TCAF". */
export const listWords = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const games = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "game" : "games"}`;

/**
 * The hero's live line, as of the build: the playoff round being played (its games in every bracket, listed and set by the
 * bracket, lib/this-round.ts) and tonight's games when there are any. Out of the playoffs, the season's games so far.
 */
export function roundLine({ season, round, leagues, tonight, seasonGames }: {
  season: number;
  /** Every game of the round being played, in every bracket. */
  round: number;
  /** The leagues with a round being played, in page order. */
  leagues: readonly string[];
  /** Tonight's night title ("Friday, Nov 20") and its game count. */
  tonight?: { title: string; count: number };
  /** The season's games on record, for the line out of the playoffs. */
  seasonGames: number;
}): string {
  const night = tonight && tonight.count > 0 ? `Tonight, ${tonight.title}: ${games(tonight.count)}.` : "";
  if (round > 0) return [`${season} playoffs this round: ${games(round)} in ${listWords(leagues)}.`, night].filter(Boolean).join(" ");
  if (night) return night;
  return `${season} season: ${games(seasonGames)} on record so far.`;
}

/** "UIL Division I and II, TAPPS, TAIAO and TCAF": the leagues with a bracket this season, UIL's divisions by name. */
export function bracketWords(brackets: readonly { name: string; league: string }[], leagues: readonly string[]): string {
  const parts = leagues.flatMap((league) => {
    const mine = brackets.filter((b) => b.league === league);
    if (!mine.length) return [];
    if (league !== "UIL") return [league];
    const divisions = mine.map((b) => b.name.match(/Division (\w+)$/)?.[1]).filter((d): d is string => !!d);
    return [divisions.length > 1 ? `UIL Division ${listWords(divisions)}` : league];
  });
  return listWords(parts);
}

export type Facts = {
  /** Programs on today's alignments, each once. */
  programs: number;
  /** Robot-read games on record, every season with results. */
  games: number;
  /** Seasons with results, and the first of them. */
  seasons: number;
  firstSeason: number;
  latestSeason: number;
  /** State Championship games on record, and the first season with one. */
  finals: number;
  firstFinal: number;
  /** Organization labels, in tab order. */
  orgs: readonly string[];
};

/** The four numbers that show what is here, each with the words under it. */
export function welcomeNumbers(f: Facts): { value: string; label: string }[] {
  return [
    { value: f.programs.toLocaleString("en-US"), label: `programs in ${listWords(f.orgs)}` },
    { value: f.games.toLocaleString("en-US"), label: `games with scores, ${f.firstSeason} to ${f.latestSeason}` },
    { value: String(f.seasons), label: `seasons of results, each with its own rankings` },
    { value: String(f.finals), label: `UIL State Championship games since ${f.firstFinal}` },
  ];
}
