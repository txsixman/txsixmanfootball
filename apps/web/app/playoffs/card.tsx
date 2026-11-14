import { latestRound, loadBrackets } from "@/lib/brackets";
import { CURRENT_SEASON } from "@/lib/season";
import { pageCard } from "../page-card";
import type { League } from "./view";

const pct = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** A league's playoffs card: each bracket's current round, or its favorite's title chance once the last four are known. */
export async function playoffsCard(league: League, season = CURRENT_SEASON) {
  const brackets = (await loadBrackets(season)).filter((b) => b.league === league);
  const lines = brackets.map((b) => {
    const name = b.name.replace(`${league} `, "") || league;
    const top = b.chances?.[0];
    return top ? `${name} · ${top.team} ${pct(top.chance)}` : `${name} · ${latestRound(b)!.label}`;
  });
  const more = lines.length > 3 ? [...lines.slice(0, 2), `and ${lines.length - 2} more brackets`] : lines;
  const kicker = brackets.some((b) => b.chances) ? `${season} ${league} · title chances` : `${season} ${league} · latest round`;
  return pageCard({ kicker, title: "Playoffs", lines: more });
}
