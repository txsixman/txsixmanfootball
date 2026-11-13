import type { Metadata } from "next";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { type Final, finalScore, loadFinals, loadNoFinal, noFinalSpans, titleCounts } from "@/lib/champions";
import { championshipsDescription } from "@/lib/descriptions";
import { finalLinker, type Linker } from "@/lib/final-linker";
import { loadIdentities } from "@/lib/identity";
import { loadLineage, successorOf } from "@/lib/lineage";
import { CrestSlot, PageHeader, SectionBar } from "../ui";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  const seasons = (await loadFinals()).map((f) => f.season);
  return {
    title: "State Championships",
    description: championshipsDescription({ first: seasons.length ? Math.min(...seasons) : undefined, latest: seasons.length ? Math.max(...seasons) : undefined, games: seasons.length }),
  };
}

function Team({ name, link, crest = true }: { name: string; link: Linker; crest?: boolean }) {
  const { href, identity, now } = link(name);
  const body = (
    <>
      {crest && <CrestSlot school={name} identity={identity} />}
      {name}
      {now && <span className="ml-2 text-[13px] font-normal text-muted">now {now}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="inline-flex min-h-11 items-center text-ink hover:text-navy hover:underline">
      {body}
    </Link>
  ) : (
    <span className="inline-flex min-h-11 items-center text-ink">{body}</span>
  );
}

const span = (finals: Final[]) => {
  const years = finals.map((f) => f.season);
  return `${Math.min(...years)} to ${Math.max(...years)}`;
};

/** UIL split six-man into Division I and Division II in 2006; before that it crowned one state champion a year. */
function Bracket({ id, title, finals, link }: { id: string; title: string; finals: Final[]; link: Linker }) {
  const rows = [...finals].sort((a, b) => b.season - a.season);
  return (
    <section aria-labelledby={id} className="mt-8 scroll-mt-4">
      <SectionBar id={id} title={title} aside={span(finals)} className="" />
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">
          {title} state championship games, newest first
        </caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="w-16 py-1.5 pl-3 text-left font-semibold">Season</th>
            <th scope="col" className="py-1.5 text-left font-semibold">Champion and runner-up</th>
            <th scope="col" className="w-24 py-1.5 pr-3 text-right font-semibold">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={`${f.season}-${f.division}`} className="border-t border-line align-top">
              <th scope="row" className="py-2 pl-3 text-left font-num text-[17px] font-bold text-navy">{f.season}</th>
              <td className="py-0.5">
                <span className="flex items-center font-semibold">
                  <Team name={f.champion} link={link} />
                </span>
                <span className="flex items-center text-[14px] text-muted">
                  <span className="sr-only">Runner-up: </span>
                  <span aria-hidden="true" className="w-12 shrink-0 pr-2 text-right text-[13px]">over</span>
                  <Team name={f.runnerUp} link={link} crest={false} />
                </span>
              </td>
              <td className="py-2 pr-3 text-right font-num text-[17px] tabular-nums text-ink">
                {f.championScore == null ? (
                  finalScore(f)
                ) : (
                  <>
                    {f.championScore}-{f.runnerUpScore}
                    {f.scoreNote && <span className="block font-sans text-[13px] leading-tight text-muted">{f.scoreNote}</span>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function ChampionshipsPage() {
  const [finals, noFinal, alignments, identities, lineage] = await Promise.all([
    loadFinals(), loadNoFinal(), loadAlignments(), loadIdentities(), loadLineage(),
  ]);
  const successors = successorOf(lineage);
  const link = finalLinker(alignments, identities, successors);
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
        note={`${finals.length} state championship games. Division I and Division II since 2006; one state champion a year before that.`}
      />

      <nav aria-label="Jump to" className="mt-4 flex flex-wrap gap-2">
        {brackets.map((b) => (
          <a key={b.id} href={`#${b.id}`} className="inline-flex min-h-11 items-center border-2 border-navy px-3 font-num text-[15px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
            {b.title}
          </a>
        ))}
      </nav>

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

      {noFinal.length > 0 && first !== undefined && (
        <p className="mt-6 max-w-prose text-[14px] text-muted">
          Before {first}, UIL six-man playoffs had no state championship game:{" "}
          {noFinalSpans(noFinal)
            .map((s) => `they ended at ${s.playedTo} ${s.from === s.to ? `in ${s.from}` : `from ${s.from} to ${s.to}`}`)
            .join(", and ")}
          .
        </p>
      )}
    </section>
  );
}
