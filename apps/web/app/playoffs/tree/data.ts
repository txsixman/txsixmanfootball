import { loadAlignments, programFor } from "@/lib/alignments";
import { layoutTree, type Group } from "@/lib/bracket-layout";
import type { Bracket } from "@/lib/brackets";
import { bracketGames } from "@/lib/game-pages";
import { kickoffTime } from "@/lib/kickoff";
import { kickoffOf, loadKickoffs, loadSites, NO_SITE, siteOf } from "@/lib/kickoffs";
import { chanceText, projectionParts } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { slugify } from "@/lib/slug";
import type { TreeState } from "@/lib/bracket-tree";

// The tree view's data (ADR 0048), worked out at build time and handed to the page's one client piece (board.tsx) and to
// the exported image (image/[size]/route.tsx) as plain values: each box with its place, its two sides, when and where,
// the projection of a game not yet played, and the address of its game page.

/** `chance`: the side's chance to win a game not yet played ("74%"), shown where its score will go. */
export type BoxSide = { text: string; key?: string; program?: string; score?: number; won?: boolean; bye?: true; chance?: string };
export type Box = {
  id: string; col: number; row: number; half: "left" | "right" | "center";
  label: string; code?: string; state: TreeState; sides: [BoxSide, BoxSide];
  /** "Fri, Nov 20 · 7:00 PM CT", or the date alone, when known. */
  when?: string; site?: string; href?: string; forfeit?: boolean;
  projection?: { margin: string; chance: string };
  /** The game this one's winner goes on to. */
  to?: string;
  /** A listed game not yet final, for the live overlay: its date, kickoff and teams as the live rows name them. */
  live?: { date: string; kickoff?: string; home: string; away: string };
};
export type TreeData = {
  name: string; league: string; cols: number; rows: number; boxes: Box[]; links: { from: string; to: string }[]; groups: Group[];
  /** The round over each column, left to right. */
  columns: string[];
  /** The rounds, first to last, with their boxes in the order they read down the tree. */
  rounds: { round: string; label: string; ids: string[] }[];
  /** Every box has a place under one final: drawn as a tree. Otherwise the bracket's later rounds are not known yet and
   * it is shown by rounds only. */
  whole: boolean;
};

/** "Nov 20": short, to fit a box beside its code; the weekday and site are in the box's title. */
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const centralDate = (utc: string) => new Date(utc).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export async function treeData(b: Bracket, season = CURRENT_SEASON): Promise<TreeData> {
  const [alignments, kickoffs, sites, pages] = await Promise.all([loadAlignments(), loadKickoffs(season), loadSites(season), season === CURRENT_SEASON ? bracketGames() : []]);
  const hrefs = new Map(pages.map((g) => [`${g.date}|${g.home.name}|${g.away.name}`, `/scores/${g.id}`]));
  const layout = layoutTree(b.tree);
  const at = new Map(layout.placed.map((p) => [p.id, p]));
  const to = new Map(b.tree.flatMap((n) => n.feeds.filter((f) => f !== null).map((f) => [f, n.id] as const)));
  const boxes = b.tree.map((n): Box => {
    const place = at.get(n.id) ?? { col: 0, row: 0, half: "left" as const };
    const g = n.game;
    const kickoff = g ? kickoffOf(kickoffs, g.date, g.home, g.away) : n.kickoff_utc;
    const date = g?.date ?? (n.kickoff_utc && centralDate(n.kickoff_utc));
    const site = g ? siteOf(sites, g.date, g.home, g.away) : n.site;
    const href = g && hrefs.get(`${g.date}|${g.home}|${g.away}`);
    return {
      id: n.id, col: place.col, row: place.row, half: place.half, label: n.label, state: n.state,
      sides: n.sides.map((s): BoxSide => {
        const program = s.team ? programFor(alignments, s.team, b.league)?.slug : undefined;
        const p = n.projection;
        const chance = p && s.team ? chanceText(p.favorite === s.team ? p.winProbability : 1 - p.winProbability) : undefined;
        return {
          text: s.text,
          ...(chance ? { chance } : {}),
          ...(s.team ? { key: slugify(s.team) } : {}),
          ...(program ? { program } : {}),
          ...(s.score != null ? { score: s.score } : {}),
          ...(s.won ? { won: true } : {}),
          ...(s.bye ? { bye: true as const } : {}),
        };
      }) as [BoxSide, BoxSide],
      ...(n.code ? { code: n.code } : {}),
      // A played game's time no longer matters: its date alone.
      ...(date ? { when: [day(date), kickoff && n.state !== "final" && n.state !== "disputed" && kickoffTime(kickoff).replace(/ CT$/, "")].filter(Boolean).join(" · ") } : {}),
      ...(site && site !== NO_SITE ? { site } : {}),
      ...(href ? { href } : {}),
      ...(g?.forfeit ? { forfeit: true } : {}),
      ...(n.projection ? { projection: projectionParts(n.projection) } : {}),
      ...(to.has(n.id) ? { to: to.get(n.id) } : {}),
      ...(g && n.state === "upcoming" && season === CURRENT_SEASON ? { live: { date: g.date, ...(kickoff ? { kickoff } : {}), home: g.home, away: g.away } } : {}),
    };
  });
  const whole = layout.placed.length === b.tree.length && b.tree.length > 1;
  // Down the tree: the left half top to bottom, the final, then the right half.
  const halfRank = { left: 0, center: 1, right: 2 };
  const reading = [...boxes].sort((x, y) => (whole ? halfRank[x.half] - halfRank[y.half] || x.row - y.row : 0));
  // b.tree is in round order, first to last (lib/bracket-fill.ts fill).
  const roundOf = new Map(b.tree.map((n) => [n.id, n]));
  const rounds = [...new Set(b.tree.map((n) => n.round))].map((round) => ({
    round, label: b.tree.find((n) => n.round === round)!.label, ids: reading.filter((x) => roundOf.get(x.id)!.round === round).map((x) => x.id),
  }));
  const columns = Array.from({ length: layout.cols }, (_, c) => boxes.find((x) => at.has(x.id) && x.col === c)?.label ?? "");
  return { name: b.name, league: b.league, cols: layout.cols, rows: layout.rows, boxes, links: layout.links, groups: layout.groups, columns, rounds, whole };
}
