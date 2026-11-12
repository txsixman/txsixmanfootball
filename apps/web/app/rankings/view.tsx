import Link from "next/link";
import { activeOrgs } from "@/lib/active-orgs";
import { loadAlignments } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgHref, type Org } from "@/lib/orgs";
import { rankedList } from "@/lib/json-ld";
import { rankedOrder } from "@/lib/rank-range";
import { placeTeams } from "@/lib/rankings";
import { loadRatings, ratingSeasons } from "@/lib/ratings";
import { schedulesFor } from "@/lib/schedule-strength";
import { rankingWeeks } from "@/lib/week-rankings";
import { JsonLd } from "../json-ld";
import { TabNav } from "../tab-nav";
import { EmptyState } from "../ui";
import { HowToRead, RankingsHeader, RatingsTable, type Row } from "./table";

// Every ranking stands inside one organization (ADR 0012): UIL, TAPPS, TAIAO, TCAF or Independent. Under UIL a second tab row
// narrows to six-man Division I or II. Every view shares one rating scale underneath, but a rank, an arrow or a
// "top" is counted among that view's own teams only. `/rankings` is all of UIL; the others are `/rankings/<org>`.
export const VIEWS = [
  { slug: "", org: ORGS[0], label: "All UIL", eyebrow: "UIL" },
  { slug: "division-1", org: ORGS[0], label: "Division I", eyebrow: "UIL Division I", division: "I" },
  { slug: "division-2", org: ORGS[0], label: "Division II", eyebrow: "UIL Division II", division: "II" },
  ...ORGS.slice(1).map((org) => ({ slug: org.slug, org, label: org.label, eyebrow: org.label })),
] as const;

export type View = (typeof VIEWS)[number];

/** The organization-wide view of an organization (all of UIL, not one division). */
export const viewOf = (org: Org): View => VIEWS.find((v) => v.org === org && !("division" in v))!;

const hrefOf = (v: View) => (v.slug ? `/rankings/${v.slug}` : "/rankings");

/** Past seasons have their own page; the latest season is /rankings. The organization is kept when the season changes. */
export const seasonHref = (season: number, latest: number, org: Org = ORGS[0]) =>
  orgHref(season === latest ? "/rankings" : `/rankings/season/${season}`, org);

/** A past season shows its final table for one organization, with teams placed by the current alignments, which may
 * not be the ones that season was played under; there are no division tabs. Movement arrows are for the season under way. */
export async function RankingsView({ view, season }: { view: View; season?: number }) {
  const [table, alignments, identities, seasons, orgs] = await Promise.all([
    loadRatings(season), loadAlignments(), loadIdentities(), ratingSeasons(), activeOrgs(view.org),
  ]);
  const { stats } = await schedulesFor(table.season, view.org.league);
  const past = table.season !== seasons[0];
  const weeks = past ? [] : await rankingWeeks(table.season);
  const { org } = view;
  const { placed, outside } = placeTeams(table.teams, alignments);
  const rows: Row[] = placed.flatMap(({ school, ...r }) => {
    if (school.league !== org.league || ("division" in view && school.division !== view.division)) return [];
    return [{ ...r, ...(past && { was: undefined }), name: school.school, href: `/programs/${school.slug}`, identity: identities.get(school.slug) ?? EMPTY, schedule: stats.get(r.team) }];
  });
  // Where each opponent's program page is, for the best win and worst loss columns.
  const hrefs = new Map(alignments.filter((a) => a.league === org.league).map((a) => [a.school, `/programs/${a.slug}`]));
  const games = table.games.toLocaleString("en-US");
  const outsideNote = outside ? ` ${outside} ${outside === 1 ? "team" : "teams"} outside these leagues ${outside === 1 ? "is" : "are"} not shown.` : "";
  const count = `${rows.length} ${rows.length === 1 ? "team" : "teams"}`; // Independent starts with one
  const note =
    (past
      ? `Final: ${count} in ${org.label} from ${games} games. Teams are placed by the current alignments.`
      : "division" in view
        ? `${count}, rated on all ${games} games of the season.`
        : `${rows.length} ${org.label} ${rows.length === 1 ? "team" : "teams"} from ${games} games.`) + outsideNote;
  const orgBase = past ? `/rankings/season/${table.season}` : "/rankings";

  const ranked = rankedOrder([...rows]); // the table's order, teams with too few games left out

  return (
    <section aria-labelledby="rankings">
      {ranked.length > 0 && <JsonLd data={rankedList(`${table.season} ${view.eyebrow} six-man rankings`, ranked.map((r) => ({ name: r.name, href: r.href! })))} />}
      <RankingsHeader eyebrow={`${table.season} season · ${view.eyebrow}`} note={table.games ? note : undefined} />
      {seasons.length > 1 && (
        <TabNav label="Season" tabs={seasons.map((y) => ({ href: seasonHref(y, seasons[0], org), label: String(y) }))} current={seasonHref(table.season, seasons[0], org)} />
      )}
      <TabNav label="Rankings by organization" tabs={orgs.map((o) => ({ href: orgHref(orgBase, o), label: o.label }))} current={orgHref(orgBase, org)} />
      {!past && org === ORGS[0] && (
        <TabNav label="Rankings by division" tabs={VIEWS.filter((v) => v.org === org).map((v) => ({ href: hrefOf(v), label: v.label }))} current={hrefOf(view)} />
      )}
      {!past && !("division" in view) && weeks.length > 0 && (
        <Link href={orgHref(`/rankings/week/${weeks.at(-1)!.number}`, org)} className="mt-2 inline-flex min-h-11 items-center font-semibold text-navy underline">
          {org.label} rankings at the end of each week
        </Link>
      )}
      {rows.length ? (
        <>
          <RatingsTable rows={rows} hrefs={hrefs} />
          <p className="mt-3 text-[13px] text-muted">Scores are not confirmed here and may change.</p>
          <HowToRead schedule />
        </>
      ) : (
        <EmptyState action={{ href: "/rankings/sample", label: "See sample rankings" }}>
          No games read yet this season. Rankings appear here once results come in, and update after every game night.
        </EmptyState>
      )}
    </section>
  );
}
