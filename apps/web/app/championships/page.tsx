import type { Metadata } from "next";
import Link from "next/link";
import { loadFinals, loadNoFinal, noFinalSpans, titleCounts } from "@/lib/champions";
import { championshipsDescription } from "@/lib/descriptions";
import { CURRENT_SEASON } from "@/lib/season";
import { recordedFinals, stateChampionships } from "@/lib/state-championships";
import { PageHeader, SectionBar } from "../ui";
import { Bracket, LeagueFinals, loadLinker, StateChampionshipTable, Team } from "./shared";
import { championshipsTitle } from "@/lib/titles";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  const seasons = (await loadFinals()).map((f) => f.season);
  return {
    title: championshipsTitle(seasons.length ? { first: Math.min(...seasons), latest: Math.max(...seasons) } : {}),
    alternates: { canonical: "/championships" },
    description: championshipsDescription({ first: seasons.length ? Math.min(...seasons) : undefined, latest: seasons.length ? Math.max(...seasons) : undefined, games: seasons.length }),
  };
}

export default async function ChampionshipsPage() {
  const [finals, noFinal, { link, successors }, season, recorded] = await Promise.all([loadFinals(), loadNoFinal(), loadLinker(), stateChampionships(CURRENT_SEASON), recordedFinals()]);
  const privateFinals = recorded.filter((f) => f.league !== "UIL");
  const brackets = [
    { id: "division-1", title: "Division I", finals: finals.filter((f) => f.division === "I") },
    { id: "division-2", title: "Division II", finals: finals.filter((f) => f.division === "II") },
    { id: "one-division", title: "One division", finals: finals.filter((f) => !f.division) },
  ].filter((b) => b.finals.length);
  const leaders = titleCounts(finals, successors).filter((t) => t.titles > 1);
  const years = finals.map((f) => f.season); // empty when the file is missing: no range to print then
  const first = years.length ? Math.min(...years) : undefined;
  const latest = years.length ? Math.max(...years) : undefined;

  return (
    <section aria-labelledby="championships">
      <PageHeader
        id="championships"
        size="md"
        eyebrow={first === undefined ? "UIL six-man" : `UIL six-man · ${first} to ${latest}`}
        title="State Championships"
        note={`${finals.length} State Championship games. Division I and Division II since 2006; one state champion a year before that.`}
      />

      <nav aria-label="Jump to" className="mt-4 flex flex-wrap gap-2">
        {brackets.map((b) => (
          <a key={b.id} href={`#${b.id}`} className="inline-flex min-h-11 items-center border-2 border-navy px-3 font-num text-[15px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
            {b.title}
          </a>
        ))}
      </nav>

      {season.length > 0 && (
        <StateChampionshipTable id="this-season" title={`${CURRENT_SEASON} State Championships`} aside="every league" items={season} link={link} />
      )}

      {brackets.map((b) => (
        <Bracket key={b.id} {...b} link={link} />
      ))}

      {leaders.length > 0 && (
        <section aria-labelledby="most" className="mt-8">
          <SectionBar id="most" title="Most state titles" aside="by today's program" className="" />
          <ol className="grid sm:grid-cols-2 sm:gap-x-6">
            {leaders.map((t) => (
              <li key={t.school} className="flex items-center justify-between gap-3 border-b border-line">
                <Team name={t.school} link={link} />
                <span className="font-num text-[20px] font-bold tabular-nums text-navy">
                  {t.titles}
                  <span className="sr-only"> titles</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {privateFinals.length > 0 && (
        <section aria-labelledby="private-leagues" className="mt-8">
          <SectionBar id="private-leagues" title="Private league State Championships" aside={[...new Set(privateFinals.map((f) => f.league))].sort().join(", ")} className="" />
          <LeagueFinals finals={privateFinals} link={link} />
        </section>
      )}

      {noFinal.length > 0 && first !== undefined && (
        <p className="mt-6 max-w-prose text-[14px] text-muted">
          Before {first}, UIL six-man playoffs had no State Championship game:{" "}
          {noFinalSpans(noFinal)
            .map((s) => `they ended at ${s.playedTo} ${s.from === s.to ? `in ${s.from}` : `from ${s.from} to ${s.to}`}`)
            .join(", and ")}
          .
        </p>
      )}
    </section>
  );
}
