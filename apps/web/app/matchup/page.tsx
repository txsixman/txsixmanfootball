import type { Metadata } from "next";
import Link from "next/link";
import { heading, slugify } from "@/lib/alignments";
import { matchupDescription } from "@/lib/descriptions";
import { loadSeasonResults } from "@/lib/games";
import { resultSeasons } from "@/lib/weeks";
import { loadRanked } from "@/lib/rankings";
import { loadRatings, record } from "@/lib/ratings";
import { type Meeting, pairKey } from "@/lib/meetings";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { PageHeader } from "../ui";
import { Matchup } from "./picker";
import { matchupTitle } from "@/lib/titles";

export const dynamic = "force-static";
export const metadata: Metadata = { title: matchupTitle(), description: matchupDescription(CURRENT_SEASON), alternates: { canonical: "/matchup" } };

const orgIndex = (league: string) => ORGS.findIndex((o) => o.league === league);

export default async function MatchupPage() {
  const [ranked, table, identities] = await Promise.all([loadRanked(), loadRatings(), loadIdentities()]);
  const teams = ranked.teams
    // A school two leagues list is ranked in each (ADR 0012); the picker offers it once, under the first.
    .filter((t, i, all) => all.findIndex((x) => x.school.slug === t.school.slug) === i)
    .map((t) => ({ slug: t.school.slug, name: t.school.school, group: heading(t.school), rating: t.rating, record: record(t), identity: identities.get(t.school.slug) ?? EMPTY, org: orgIndex(t.school.league) }))
    // The reader may compare teams of two organizations, but the pickers list each organization's teams on their own
    // (ADR 0012): one option group per organization division, in the site's organization order (UIL first).
    .sort((x, y) => x.org - y.org || x.group.localeCompare(y.group) || x.name.localeCompare(y.name));
  // Every game between two of these teams in any season read, newest first, keyed by the pair.
  const rated = new Set(teams.map((t) => t.slug));
  const meetings: Record<string, Meeting[]> = {};
  for (const season of await resultSeasons()) {
    for (const g of await loadSeasonResults(season)) {
      const [home, away] = [slugify(g.home), slugify(g.away)];
      if (!rated.has(home) || !rated.has(away)) continue;
      (meetings[pairKey(home, away)] ??= []).push(g.forfeit ? [g.date, home, g.homeScore, g.awayScore, true] : [g.date, home, g.homeScore, g.awayScore]);
    }
  }
  for (const list of Object.values(meetings)) list.sort((x, y) => y[0].localeCompare(x[0]));
  return (
    <section aria-labelledby="matchup" className="max-w-4xl">
      <PageHeader
        id="matchup"
        eyebrow={`${ranked.season} season`}
        title="Matchup"
        note="Any two rated teams, from this season’s ratings. A projection, not a result."
      />
      <Link href="/rankings/how" className="link-more">How it works</Link>
      <Matchup teams={teams} meetings={meetings} table={{ games: table.games, home_field: table.home_field, sigma: table.sigma, playoff_edge: table.playoff_edge, calibration: table.calibration, teams: table.teams.map(({ team, rating, rated, won, lost, tied }) => ({ team, rating, rated, won, lost, tied })) }} />
    </section>
  );
}
