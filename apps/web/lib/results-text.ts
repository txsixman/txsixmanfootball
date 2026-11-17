// One results week as plain text for a small-town paper or a radio station to print or read out (ADR 0102). Pure, no imports:
// the node tests run it as it is. A final score is a confirmed final (ADR 0040), so a line reads "Away 22, Home 77", away team
// first as every page lists a game (ADR 0037). A forfeit never shows its recorded 1-0 or 2-0 (ADR 0004): it names the team
// given the game. A score the sources disagree on is "score reported", with no score and no team ahead. No page names a data
// source, so the closing credit names the site (ADR 0009).

/** One game of the week, already placed. `reported`: the sources give it different winners (ADR 0040), so its score is not printed.
 * `group` names a district or a playoff round; `order` puts playoff rounds earliest first. `games` is a regular-season game of a
 * season whose districts are not known, which is not claimed to be outside one. */
export type TextGame = {
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  forfeit: boolean;
  reported: boolean;
  section: "district" | "non-district" | "games" | "playoff";
  group?: string;
  order?: number;
};

const SECTIONS = [
  { section: "district", title: "DISTRICT GAMES" },
  { section: "non-district", title: "NON-DISTRICT GAMES" },
  { section: "games", title: "GAMES" },
  { section: "playoff", title: "PLAYOFF GAMES" },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FORFEIT_NOTE = "Forfeit: the team in parentheses was awarded the game.";
const CREDIT = "Scores from txsixmanfootball.com";

const numeric = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** "Oct 26 to Nov 1, 2026"; the year after each end when the week crosses New Year. */
function span(from: string, to: string): string {
  const part = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${part(from)} to ${part(to)}, ${to.slice(0, 4)}` : `${part(from)}, ${from.slice(0, 4)} to ${part(to)}, ${to.slice(0, 4)}`;
}

function line(g: TextGame): string {
  if (g.reported) return `${g.away} vs ${g.home}, score reported`;
  if (g.forfeit) return `${g.away} vs ${g.home}, forfeit (${g.homeScore > g.awayScore ? g.home : g.away})`;
  return `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}`;
}

/**
 * The week as text: a title and the dates (Monday to Sunday), then district games by district, non-district games by date,
 * and playoff games by round, earliest round first. Inside a group, by date, then home team, then away team. A section with
 * no game is left out. The last line is the credit.
 */
export function resultsText({ title, from, to, games }: { title: string; from: string; to: string; games: TextGame[] }): string {
  const out = [title, `Games played ${span(from, to)}`, "Away team listed first.", ""];
  for (const { section, title: heading } of SECTIONS) {
    const mine = games.filter((g) => g.section === section);
    if (!mine.length) continue;
    out.push(heading, "");
    const groups = [...Map.groupBy(mine, (g) => g.group ?? "")].sort(
      ([an, a], [bn, b]) => Math.min(...a.map((g) => g.order ?? 0)) - Math.min(...b.map((g) => g.order ?? 0)) || numeric(an, bn),
    );
    for (const [name, list] of groups) {
      if (name) out.push(name);
      for (const g of list.toSorted((a, b) => a.date.localeCompare(b.date) || numeric(a.home, b.home) || numeric(a.away, b.away))) out.push(line(g));
      out.push("");
    }
  }
  if (!games.length) out.push("No games reported this week.", "");
  if (games.some((g) => g.forfeit && !g.reported)) out.push(FORFEIT_NOTE, "");
  out.push(CREDIT);
  return `${out.join("\n")}\n`;
}
