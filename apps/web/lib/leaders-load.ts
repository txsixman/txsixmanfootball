import { isDisputed, loadDisputed } from "./disputed";
import { loadSeasonResults } from "./games";
import { type Boards, inLeaderView, LEADER_VIEWS, leaderBoards, type LeaderView } from "./leaders";
import { memo } from "./memo";
import { schoolAlignments } from "./org-games";
import { CURRENT_SEASON } from "./season";
import { resultSeasons } from "./weeks";

// The scoring leaders pages (/leaders, ADR 0101): a season and a view (all of UIL, UIL Division I or II, or one other
// organization) each have a page. The latest season is /leaders and its views /leaders/<view>; a past season is
// /leaders/<season> and /leaders/<season>/<view>. Teams are placed by the current alignments, as the rankings place a
// past season's teams.

/** Seasons with games read, newest first, none past the current season. */
export const leaderSeasons = memo<void, number[]>(async () => (await resultSeasons()).filter((s) => s <= CURRENT_SEASON));

/** Every page: a season and a view of an organization that has a game in it. */
export const leaderPages = memo<void, { season: number; view: LeaderView }[]>(async () => {
  const [seasons, ...orgSeasons] = await Promise.all([leaderSeasons(), ...LEADER_VIEWS.map((v) => resultSeasons(v.org))]);
  return seasons.flatMap((season) => LEADER_VIEWS.filter((_, i) => orgSeasons[i].includes(season)).map((view) => ({ season, view })));
});

/** The page an address names: no parts is the latest season's UIL; one part is a view of the latest season or a past season
 * (a year); two are a past season and a view. Undefined when no such page exists. */
export async function resolveLeaders(parts: string[]): Promise<{ season: number; view: LeaderView } | undefined> {
  const [latest] = await leaderSeasons();
  const [first, second] = parts;
  const year = first !== undefined && /^\d{4}$/.test(first) ? Number(first) : undefined;
  if (parts.length > 2 || (parts.length === 2 && year === undefined) || year === latest) return undefined; // the latest season has no year in its address
  const season = year ?? latest;
  const slug = (year === undefined ? first : second) ?? "";
  return (await leaderPages()).find((p) => p.season === season && p.view.slug === slug);
}

/** A season's lists for one view: confirmed finals only, disputed ones marked from the disputed list (lib/disputed.ts). */
const load = memo<string, Boards>(async (key) => {
  const [year, slug] = key.split("|");
  const view = LEADER_VIEWS.find((v) => v.slug === slug)!;
  const season = Number(year);
  const [results, schools, disputed] = await Promise.all([loadSeasonResults(season), schoolAlignments(), loadDisputed(season)]);
  return leaderBoards(
    results.map((g) => ({ ...g, disputed: isDisputed(disputed, g.date, g.home, g.away) })),
    (team) => inLeaderView(view, schools.get(team)),
  );
});

export const loadLeaders = (season: number, view: LeaderView): Promise<Boards> => load(`${season}|${view.slug}`);
