import Link from "next/link";
import { notFound } from "next/navigation";
import { activeOrgs } from "@/lib/active-orgs";
import { loadAlignments } from "@/lib/alignments";
import { rankingsWeekDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { orgHref, type Org } from "@/lib/orgs";
import { placeTeams } from "@/lib/rankings";
import { ratingSeasons } from "@/lib/ratings";
import { rankingWeeks, weekRows } from "@/lib/week-rankings";
import { TabNav } from "../../tab-nav";
import { WeekStrip } from "../../week-strip";
import { RankingsHeader, RatingsTable, type Row } from "../table";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The meta description of an organization's rankings after week `week` of the season under way. */
export async function describeWeekRankings(org: Org, week: string) {
  const [season] = await ratingSeasons();
  return rankingsWeekDescription({ label: org.label, season, week: Number(week) });
}

/** One organization's rankings as they stood at the end of a week of the season under way (ADR 0012: ranks and arrows
 * count that organization's teams only). `/rankings/week/<n>` is UIL, `/rankings/week/<n>/<org>` the others. */
export async function WeekRankings({ wanted, org }: { wanted: string; org: Org }) {
  const [season] = await ratingSeasons();
  const [weeks, alignments, identities, orgs] = await Promise.all([rankingWeeks(season), loadAlignments(), loadIdentities(), activeOrgs(org)]);
  const week = weeks.find((w) => String(w.number) === wanted);
  if (!week) notFound();
  const { placed, outside } = placeTeams(await weekRows(season, week), alignments);
  const rows: Row[] = placed
    .filter(({ school }) => school.league === org.league)
    .map(({ school, ...r }) => ({ ...r, name: school.school, href: `/programs/${school.slug}`, identity: identities.get(school.slug) ?? EMPTY }));
  const outsideNote = outside ? ` ${outside} ${outside === 1 ? "team" : "teams"} outside these leagues ${outside === 1 ? "is" : "are"} not shown.` : "";
  const weekBase = (n: number) => `/rankings/week/${n}`;

  return (
    <section aria-labelledby="rankings">
      <RankingsHeader
        eyebrow={`${season} season · ${org.label} · after week ${week.number}`}
        note={`${rows.length} ${org.label} ${rows.length === 1 ? "team" : "teams"}, rated on the games played by Sunday, ${day(week.sunday)}. Arrows show the move from a week earlier.${outsideNote}`}
      />
      <TabNav label="Rankings by organization" tabs={orgs.map((o) => ({ href: orgHref(weekBase(week.number), o), label: o.label }))} current={orgHref(weekBase(week.number), org)} />
      <WeekStrip
        prefetch={false}
        weeks={weeks.map((w) => ({ number: w.number, href: orgHref(weekBase(w.number), org), label: `After week ${w.number}, ending ${day(w.sunday)}`, current: w.number === week.number }))}
        after={
          <Link href={orgHref("/rankings", org)} className="inline-flex min-h-11 shrink-0 items-center border-2 border-navy px-3 font-num text-[16px] font-bold uppercase text-navy hover:bg-panel">
          Now
        </Link>
        }
      />
      <RatingsTable rows={rows} />
      <p className="mt-3 text-[13px] text-muted">
        Scores may be corrected if a mistake is found. Records count forfeits; ratings leave them out. Under each team: games played and games rated, through that Sunday.
      </p>
      <Link href="/about/ratings" className="inline-flex min-h-11 items-center font-semibold text-navy underline">What a rating rests on</Link>
    </section>
  );
}
