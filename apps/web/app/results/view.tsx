import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { loadAlignments, programFor } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgHref, type Org } from "@/lib/orgs";
import { pregame } from "@/lib/pregame";
import { projectionText } from "@/lib/projection";
import { loadWeeks, resultSeasons, weekLabel, type Week } from "@/lib/weeks";
import { TabNav } from "../tab-nav";
import { WeekStrip } from "../week-strip";
import { CrestSlot, EmptyState, PageHeader, SectionBar } from "../ui";
import { seasonHref, weekHref } from "./paths";

/** One week of one organization's results: the games with a team in it, whoever the other team is (ADR 0012). Robot-read
 * scores are unconfirmed, so no row names a winner (ADR 0004, ADR 0008). */
export async function ResultsWeek({ org, season, week }: { org: Org; season: number; week: number }) {
  const [weeks, seasons, alignments, identities, before, orgSeasons] = await Promise.all([
    loadWeeks(season, org),
    resultSeasons(org),
    loadAlignments(),
    loadIdentities(),
    pregame(season),
    Promise.all(ORGS.map(async (o) => [o, await resultSeasons(o)] as const)),
  ]);
  const shown = weeks.find((w) => w.number === week) as Week;
  const days = Map.groupBy(shown.games, (g) => g.status);

  const team = (name: string) => {
    const slug = programFor(alignments, name, org.league)?.slug;
    return (
      <span className="flex min-h-11 items-center">
        <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />
        {slug ? (
          <Link href={`/programs/${slug}`} className="min-w-0 flex-1 truncate leading-[2.75rem] hover:text-navy hover:underline">
            {name}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate">{name}</span>
        )}
      </span>
    );
  };
  /** Both scores in one link to the game's page, beside the two team lines. A forfeit has no score to show. */
  const scores = (g: (typeof shown.games)[number]) => (
    <Link
      href={g.href}
      aria-label={`${g.away} at ${g.home}${g.forfeit ? ", forfeit" : `, ${g.awayScore}-${g.homeScore}`}, game page`}
      className="flex shrink-0 items-center gap-1 pl-2 hover:bg-panel"
    >
      <span className="flex flex-col text-right font-num text-[20px] font-bold tabular-nums">
        <span className="flex min-h-11 w-9 items-center justify-end">{g.forfeit ? "" : g.awayScore}</span>
        <span className="flex min-h-11 w-9 items-center justify-end">{g.forfeit ? "" : g.homeScore}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 text-muted" />
    </Link>
  );

  return (
    <section aria-labelledby="results">
      <PageHeader id="results" eyebrow={`${org.label} · ${season} season · Week ${week} · ${shown.games.length} games`} title="Results" />
      {/* Switching organization keeps the week; an organization with no game that season opens on its latest. */}
      <TabNav
        label="Organization"
        tabs={orgSeasons.filter(([o, played]) => o === org || played.length).map(([o, played]) => ({ href: played.includes(season) ? weekHref(season, week, o) : orgHref("/results", o), label: o.label }))}
        current={weekHref(season, week, org)}
      />
      {seasons.length > 1 && (
        <TabNav
          label="Season"
          tabs={seasons.map((s) => ({ href: seasonHref(s, seasons[0], org), label: String(s) }))}
          current={seasonHref(season, seasons[0], org)}
        />
      )}
      <WeekStrip weeks={weeks.map((w) => ({ number: w.number, href: weekHref(season, w.number, org), label: `Week ${w.number}, from ${weekLabel(w.monday)}`, current: w.number === week }))} />
      {!shown.games.length && <EmptyState>No {org.label} games this week.</EmptyState>}
      {[...days].map(([day, games]) => (
        <section key={day} aria-labelledby={`day-${day.replace(/\W+/g, "-")}`} className="mt-6">
          <SectionBar id={`day-${day.replace(/\W+/g, "-")}`} title={day} className="" />
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {games.map((g) => (
              <li key={g.id} className="min-w-0 border-b border-line py-1 text-[15px] text-ink">
                <div className="flex items-stretch">
                  <div className="min-w-0 flex-1">
                    {team(g.away)}
                    {team(g.home)}
                  </div>
                  {scores(g)}
                </div>
                {g.forfeit && <p className="pb-1 pl-[3rem] text-[13px] font-semibold text-muted">Forfeit</p>}
                {/* What the ratings said the week before; it names no winner of this game (ADR 0004). */}
                {before.has(g.id) && <p className="pb-1 pl-[3rem] text-[13px] text-muted">Projected: {projectionText(before.get(g.id)!)}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-4 text-[13px] text-muted">
        Away team first. Scores are not confirmed here and may change. Projections use both teams&rsquo; ratings from the week
        before, once each has played four games.
      </p>
    </section>
  );
}
