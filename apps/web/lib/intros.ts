// The plain-words line under a playoff page's heading: what the page holds, in the words a fan searches for ("2026 UIL six-man
// playoffs", "Division I bracket"), and what it gives that a bare bracket does not. It names no winner (ADR 0004), no source
// (ADR 0010) and no betting word: projected margin and chance to win only.

/** "Division I and Division II" from "UIL Division I", "UIL Division II": each bracket's name without its league. */
function bracketList(league: string, names: string[]): string {
  const short = names.map((n) => n.replace(new RegExp(`^${league} `), ""));
  return short.length < 2 ? short.join("") : `${short.slice(0, -1).join(", ")} and ${short.at(-1)}`;
}

/** One league's playoffs page. `chances`: some bracket shows title chances. */
export function playoffsIntro({ league, season, brackets, past, chances }: { league: string; season: number; brackets: string[]; past: boolean; chances: boolean }): string {
  const what = brackets.length ? `, ${bracketList(league, brackets)},` : "";
  if (past) return `Every ${season} ${league} six-man playoff game${what} round by round, with each team's next game showing who went on.`;
  return [
    `Every ${season} ${league} six-man playoff game${what} round by round.`,
    "Scores update through each game night, and every game still to play has a projected margin and each team's chance to win.",
    chances ? "Each team's chance at a title is under its bracket." : "",
    "Free to read, no sign-in.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One bracket's own page. */
export const bracketIntro = ({ name, season }: { name: string; season: number }) =>
  `The ${season} ${name} six-man playoff bracket, the round being played first. Every game still to play has a projected margin and each team's chance to win, and a team's next game shows who went on.`;

/** The home page's second line: what a fan gets here, in plain words. `firstFinal`: the first state final on record. */
export const homeEdge = ({ firstSeason, firstFinal }: { firstSeason: number; firstFinal: number }) =>
  `Free, with no sign-in: scores through every game night, a projected margin and each team's chance to win for every game still to play, brackets that fill in as games finish, results since ${firstSeason} and every UIL state final since ${firstFinal}.`;
