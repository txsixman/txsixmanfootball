import { loadAlignments, programFor, uniquePrograms } from "./alignments";
import { loadGames, loadSeasonResults } from "./games";
import { EMPTY, loadIdentities, type Identity } from "./identity";
import { memo } from "./memo";
import { seasonRows, type Row } from "./program-games";
import { loadRanked } from "./rankings";
import { record } from "./ratings";
import { CURRENT_SEASON } from "./season";

/** One game as "My teams" shows it: the program page's own row (lib/program-games.ts), plus the opponent's page when it has one. */
export type MyGame = Pick<Row, "status" | "home" | "opponent" | "score" | "note" | "href" | "playoff"> & { opponentSlug?: string };

/** What the home page's "My teams" block shows for one followed program. Built at build time (the site is static) and
 * served from app/my-teams/[slug]: the browser asks only for the programs it follows. Public facts only; no source
 * names (ADR 0010); no winner is named and a forfeit carries the word, not the score (ADR 0004). */
export type MyTeam = {
  slug: string;
  school: string;
  crest: Identity;
  /** The program page's "record" figure; null until the team is rated. */
  record: string | null;
  last: MyGame | null;
  next: MyGame | null;
};

/** Shared across routes: never mutate it. */
export const loadMyTeams = memo<void, Map<string, MyTeam>>(async () => {
  const [all, ranked, identities, games, results] = await Promise.all([
    loadAlignments(), loadRanked(), loadIdentities(), loadGames(await loadAlignments()), loadSeasonResults(CURRENT_SEASON),
  ]);
  const rated = new Map(ranked.teams.map((t) => [t.school.slug, t]));
  return new Map(
    uniquePrograms(all).map((school) => {
      const { latest, next } = seasonRows(school.school, games, results);
      const game = (r: Row | undefined): MyGame | null =>
        r ? { status: r.status, home: r.home, opponent: r.opponent, score: r.score, note: r.note, href: r.href, playoff: r.playoff, opponentSlug: programFor(all, r.opponent, school.league)?.slug } : null;
      const team = rated.get(school.slug);
      // The crest needs only the logo and colors; the rest of the identity stays out of the JSON.
      const identity = identities.get(school.slug) ?? EMPTY;
      const crest: Identity = { mascot: null, colors: [], logo: identity.logo, theme: identity.theme };
      return [school.slug, { slug: school.slug, school: school.school, crest, record: team ? record(team) : null, last: game(latest), next: game(next) }];
    }),
  );
});
