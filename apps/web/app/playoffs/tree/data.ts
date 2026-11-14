import { loadAlignments, programFor } from "@/lib/alignments";
import { layoutTree, type Group } from "@/lib/bracket-layout";
import type { Bracket } from "@/lib/brackets";
import { bracketGames } from "@/lib/game-pages";
import { kickoffTime } from "@/lib/kickoff";
import { kickoffOf, loadKickoffs, loadSites, NO_SITE, siteOf } from "@/lib/kickoffs";
import { chanceText, projectionParts, type Projection } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { slugify } from "@/lib/slug";
import type { TreeGame, TreeState } from "@/lib/bracket-tree";

// The tree view's data (ADR 0049), worked out at build time and handed to the page's one client piece (board.tsx) and to
// the exported image (image/[size]/route.tsx) as plain values: each box with its place, its two sides, when and where,
// the projection of a game not yet played, and the address of its game page.

/** `chance`: the side's chance to win a game not yet played ("74%"), shown where its score will go. */
export type BoxSide = { text: string; title?: string; key?: string; program?: string; score?: number; won?: boolean; bye?: true; chance?: string };
export type Box = {
  id: string; col: number; row: number; half: "left" | "right" | "center";
  label: string; code?: string; state: TreeState; sides: [BoxSide, BoxSide];
  /** "Nov 20", when known; `time` is the kickoff ("7:00 PM") of a game not yet played. */
  when?: string; time?: string; site?: string; href?: string; forfeit?: boolean;
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

/** A box of the bracket as lib/brackets.ts gives it: the slot, its round's label, its projection. */
type Node = TreeGame & { label: string; projection?: Projection };
/** What the site knows about a box beyond its bracket: the kickoff (UTC), the site, its game page, and whether to look
 * for a live score. */
export type BoxInfo = { kickoff?: string; site?: string; href?: string; live?: boolean };

export async function treeData(b: Bracket, season = CURRENT_SEASON): Promise<TreeData> {
  const [alignments, kickoffs, sites, pages] = await Promise.all([loadAlignments(), loadKickoffs(season), loadSites(season), season === CURRENT_SEASON ? bracketGames() : []]);
  const hrefs = new Map(pages.map((g) => [`${g.date}|${g.home.name}|${g.away.name}`, `/scores/${g.id}`]));
  return buildTree(b.name, b.league, b.tree, (n) => {
    const g = n.game;
    if (!g) return { kickoff: n.kickoff_utc, site: n.site };
    const site = siteOf(sites, g.date, g.home, g.away);
    return {
      kickoff: kickoffOf(kickoffs, g.date, g.home, g.away),
      site: site === NO_SITE ? undefined : site,
      href: hrefs.get(`${g.date}|${g.home}|${g.away}`),
      live: n.state === "upcoming" && season === CURRENT_SEASON,
    };
  }, (team) => programFor(alignments, team, b.league)?.slug);
}

/** The tree's boxes, places and rounds from a bracket's slots and what the site knows of each (pure: the sample page uses
 * it with invented schools). `program` gives a team's program page slug, if it has one. */
export function buildTree(name: string, league: string, tree: Node[], info: (n: Node) => BoxInfo, program: (team: string) => string | undefined): TreeData {
  const layout = layoutTree(tree);
  const at = new Map(layout.placed.map((p) => [p.id, p]));
  const to = new Map(tree.flatMap((n) => n.feeds.filter((f) => f !== null).map((f) => [f, n.id] as const)));
  const boxes = tree.map((n): Box => {
    const place = at.get(n.id) ?? { col: 0, row: 0, half: "left" as const };
    const g = n.game;
    const { kickoff, site, href, live } = info(n);
    const date = g?.date ?? (kickoff && centralDate(kickoff));
    return {
      id: n.id, col: place.col, row: place.row, half: place.half, label: n.label, state: n.state,
      sides: n.sides.map((s): BoxSide => {
        const slug = s.team ? program(s.team) : undefined;
        const p = n.projection;
        const chance = p && s.team ? chanceText(p.favorite === s.team ? p.winProbability : 1 - p.winProbability) : undefined;
        return {
          text: s.text,
          ...(s.title ? { title: s.title } : {}),
          ...(chance ? { chance } : {}),
          ...(s.team ? { key: slugify(s.team) } : {}),
          ...(slug ? { program: slug } : {}),
          ...(s.score != null ? { score: s.score } : {}),
          ...(s.won ? { won: true } : {}),
          ...(s.bye ? { bye: true as const } : {}),
        };
      }) as [BoxSide, BoxSide],
      ...(n.code ? { code: n.code } : {}),
      ...(date ? { when: day(date) } : {}),
      // A played game's time no longer matters: its date alone.
      ...(kickoff && n.state !== "final" && n.state !== "disputed" ? { time: kickoffTime(kickoff).replace(/ CT$/, "") } : {}),
      ...(site ? { site } : {}),
      ...(href ? { href } : {}),
      ...(g?.forfeit ? { forfeit: true } : {}),
      ...(n.projection ? { projection: projectionParts(n.projection) } : {}),
      ...(to.has(n.id) ? { to: to.get(n.id) } : {}),
      ...(g && live ? { live: { date: g.date, ...(kickoff ? { kickoff } : {}), home: g.home, away: g.away } } : {}),
    };
  });
  const whole = layout.placed.length === tree.length && tree.length > 1;
  // Down the tree: the left half top to bottom, the final, then the right half.
  const halfRank = { left: 0, center: 1, right: 2 };
  const reading = [...boxes].sort((x, y) => (whole ? halfRank[x.half] - halfRank[y.half] || x.row - y.row : 0));
  // The tree is in round order, first to last (lib/bracket-fill.ts fill).
  const roundOf = new Map(tree.map((n) => [n.id, n]));
  const rounds = [...new Set(tree.map((n) => n.round))].map((round) => ({
    round, label: tree.find((n) => n.round === round)!.label, ids: reading.filter((x) => roundOf.get(x.id)!.round === round).map((x) => x.id),
  }));
  if (!whole) {
    // Not one tree yet: the image draws it as columns of rounds, the games of each stacked, with no connectors.
    for (const [c, r] of rounds.entries()) r.ids.forEach((id, i) => Object.assign(boxes.find((x) => x.id === id)!, { col: c, row: i, half: "left" }));
    const rows = Math.max(...rounds.map((r) => r.ids.length));
    return { name, league, cols: rounds.length, rows, boxes, links: [], groups: [], columns: rounds.map((r) => r.label), rounds, whole };
  }
  const columns = Array.from({ length: layout.cols }, (_, c) => boxes.find((x) => at.has(x.id) && x.col === c)?.label ?? "");
  return { name, league, cols: layout.cols, rows: layout.rows, boxes, links: layout.links, groups: layout.groups, columns, rounds, whole };
}
