// Team scoring leaders for one season and one view (ADR 0101), from confirmed final scores only: a forfeit (recorded 1-0 or
// 2-0, lib/forfeit.ts), a disputed final (lib/disputed.ts) and a 0-0 (no score, ADR 0040) are left out of every list and
// counted so the page can say so. Pure: it imports only types and lib/orgs.ts, so node tests it directly
// (scripts/leaders.test.mjs). Teams only, never players (CLAUDE.md, minors).
import { ORGS } from "./orgs.ts";
import type { SeasonResult } from "./season-results.ts";
import { LEADER_MIN_GAMES } from "./season-leaders.ts";

/** A game scored this many points ahead is a win by the 45-point rule: six-man ends a game there at the half or later. */
export const MERCY_MARGIN = 45;
/** A team that scores this many points in a game has a 60-point game. */
export const HIGH_SCORE = 60;
/** The whole-season total of points allowed is only fair between teams that played most of a schedule. */
export const SEASON_MIN_GAMES = 8;
/** Rows shown a list. */
const TOP = 10;

/** One page of leaders: UIL as a whole, UIL Division I or II, or another organization (ADR 0012: never two together).
 * `slug` is the address after the season's: "" for all of UIL. */
export const LEADER_VIEWS = [
  { slug: "", org: ORGS[0], label: "All UIL", name: "UIL" },
  { slug: "division-1", org: ORGS[0], label: "Division I", name: "UIL Division I", division: "I" },
  { slug: "division-2", org: ORGS[0], label: "Division II", name: "UIL Division II", division: "II" },
  ...ORGS.slice(1).map((org) => ({ slug: org.slug, org, label: org.label, name: org.label })),
] as const;

export type LeaderView = (typeof LEADER_VIEWS)[number];

/** The page of leaders for `season` (the latest has no season in its address) and `view`: `/leaders`, `/leaders/tapps`,
 * `/leaders/2025`, `/leaders/2025/division-1`. */
export function leadersHref(season: number, latest: number, view: LeaderView): string {
  const base = season === latest ? "/leaders" : `/leaders/${season}`;
  return view.slug ? `${base}/${view.slug}` : base;
}

/** The view a school's own ranking sits in: its UIL six-man division, else its organization. */
export function viewOfSchool(school: { league: string; division: string }): LeaderView | undefined {
  return (
    LEADER_VIEWS.find((v) => "division" in v && v.org.league === school.league && v.division === school.division) ??
    LEADER_VIEWS.find((v) => !("division" in v) && v.org.league === school.league)
  );
}

/** Whether a team is in a view, by the alignments that list it (a team no alignment lists is in none). */
export const inLeaderView = (view: LeaderView, listed: readonly { league: string; division: string }[] | undefined): boolean =>
  (listed ?? []).some((a) => a.league === view.org.league && (!("division" in view) || a.division === view.division));

type LeaderGame = Pick<SeasonResult, "home" | "away" | "homeScore" | "awayScore" | "forfeit" | "date" | "href"> & { disputed?: boolean };

type Place = { place: number; tied: boolean };
/** A team on a list: `value` is the figure the list ranks (an average rounded to one decimal, or a count). */
export type TeamEntry = Place & { team: string; games: number; value: number };
/** A team's score in one game. */
export type GameEntry = Place & { team: string; opponent: string; points: number; against: number; date: string; href: string };

export type Boards = {
  /** Confirmed finals counted: those with at least one team of the view. */
  counted: number;
  /** Games with a team of the view left out: forfeits, and disputed finals. */
  left: { forfeits: number; disputed: number };
  scored: TeamEntry[];
  allowed: TeamEntry[];
  margin: TeamEntry[];
  shutouts: TeamEntry[];
  mercy: TeamEntry[];
  sixty: TeamEntry[];
  seasonAllowed: TeamEntry[];
  singles: GameEntry[];
};

/** `rows` best first by `key` (`dir` 1 is lowest first, -1 highest first), then by name; a place is the number of rows
 * ahead plus one, so tied rows share it ("1, 2, 2, 4"). */
function placed<T extends { team: string }>(rows: T[], key: (row: T) => number, dir: 1 | -1): (T & Place)[] {
  const sorted = [...rows].sort((a, b) => dir * (key(a) - key(b)) || a.team.localeCompare(b.team));
  let first = 0;
  return sorted.map((row, i) => {
    const sameAsPrevious = i > 0 && key(sorted[i - 1]) === key(row);
    if (!sameAsPrevious) first = i;
    return { ...row, place: first + 1, tied: sameAsPrevious || (i + 1 < sorted.length && key(sorted[i + 1]) === key(row)) };
  });
}

const tenths = (n: number) => Math.round(n * 10) / 10;

/**
 * Every team list of a view, each best first with places (ties share one). `include` says which teams are in the view; a
 * game counts for each side that is. A rate list (per game) and the counts need `min` games; the whole-season total of
 * points allowed needs SEASON_MIN_GAMES. Averages are rounded to one decimal first, so two teams that print the same
 * figure are tied. A count list shows only teams with at least one. The single-game list has no minimum.
 */
export function leaderBoards(games: readonly LeaderGame[], include: (team: string) => boolean, { min = LEADER_MIN_GAMES }: { min?: number } = {}): Boards {
  const totals = new Map<string, { games: number; scored: number; allowed: number; shutouts: number; mercy: number; sixty: number }>();
  const singles: Omit<GameEntry, keyof Place>[] = [];
  const left = { forfeits: 0, disputed: 0 };
  let counted = 0;
  for (const g of games) {
    const sides = [
      { team: g.home, opponent: g.away, points: g.homeScore, against: g.awayScore },
      { team: g.away, opponent: g.home, points: g.awayScore, against: g.homeScore },
    ].filter((s) => include(s.team));
    if (!sides.length) continue;
    if (g.forfeit) {
      left.forfeits += 1;
      continue;
    }
    if (g.disputed) {
      left.disputed += 1;
      continue;
    }
    if (g.homeScore === 0 && g.awayScore === 0) continue; // a 0-0 is no score (ADR 0040)
    counted += 1;
    for (const s of sides) {
      const t = totals.get(s.team) ?? { games: 0, scored: 0, allowed: 0, shutouts: 0, mercy: 0, sixty: 0 };
      t.games += 1;
      t.scored += s.points;
      t.allowed += s.against;
      if (s.against === 0) t.shutouts += 1;
      if (s.points - s.against >= MERCY_MARGIN) t.mercy += 1;
      if (s.points >= HIGH_SCORE) t.sixty += 1;
      totals.set(s.team, t);
      singles.push({ team: s.team, opponent: s.opponent, points: s.points, against: s.against, date: g.date, href: g.href });
    }
  }
  const eligible = (atLeast: number) => [...totals].filter(([, t]) => t.games >= atLeast);
  const rate = (value: (t: { games: number; scored: number; allowed: number }) => number, dir: 1 | -1) =>
    placed(
      eligible(min).map(([team, t]) => ({ team, games: t.games, value: tenths(value(t)) })),
      (r) => r.value,
      dir,
    );
  const count = (value: (t: { shutouts: number; mercy: number; sixty: number }) => number) =>
    placed(
      eligible(min).flatMap(([team, t]) => (value(t) > 0 ? [{ team, games: t.games, value: value(t) }] : [])),
      (r) => r.value,
      -1,
    );
  return {
    counted,
    left,
    scored: rate((t) => t.scored / t.games, -1),
    allowed: rate((t) => t.allowed / t.games, 1),
    margin: rate((t) => (t.scored - t.allowed) / t.games, -1),
    shutouts: count((t) => t.shutouts),
    mercy: count((t) => t.mercy),
    sixty: count((t) => t.sixty),
    seasonAllowed: placed(
      eligible(SEASON_MIN_GAMES).map(([team, t]) => ({ team, games: t.games, value: t.allowed })),
      (r) => r.value,
      1,
    ),
    // Most points first; a tie keeps the place and lists the team's name order.
    singles: placed(
      [...singles].sort((a, b) => a.date.localeCompare(b.date)),
      (r) => r.points,
      -1,
    ),
  };
}

/** The first `n` rows of a list, and how many more share the last shown row's place (a tie that runs past the end is said,
 * never cut off silently or allowed to stretch the list). */
export function topRows<T extends { place: number }>(rows: readonly T[], n = TOP): { shown: T[]; more: number; place: number } {
  const shown = rows.slice(0, n);
  const last = shown.at(-1);
  return { shown, more: last ? rows.slice(n).filter((r) => r.place === last.place).length : 0, place: last?.place ?? 0 };
}
