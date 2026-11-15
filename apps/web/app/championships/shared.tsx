import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { type Final, finalScore } from "@/lib/champions";
import { finalLinker, type Linker } from "@/lib/final-linker";
import { loadIdentities } from "@/lib/identity";
import { loadLineage, successorOf } from "@/lib/lineage";
import { CrestSlot, SectionBar } from "../ui";

export function Team({ name, link, crest = true }: { name: string; link: Linker; crest?: boolean }) {
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
  return Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} to ${Math.max(...years)}`;
};

/** UIL split six-man into Division I and Division II in 2006; before that it crowned one state champion a year. */
export function Bracket({ id, title, finals, link, yearLinks = true }: { id: string; title: string; finals: Final[]; link: Linker; yearLinks?: boolean }) {
  const rows = [...finals].sort((a, b) => b.season - a.season);
  return (
    <section aria-labelledby={id} className="mt-8 scroll-mt-4">
      <SectionBar id={id} title={title} aside={span(finals)} className="" />
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">
          {title} State Championship {rows.length > 1 ? "games, newest first" : "game"}
        </caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="w-16 py-1.5 pl-3 text-left font-semibold">Season</th>
            <th scope="col" className="py-1.5 text-left font-semibold">Champion and runner-up</th>
            <th scope="col" className="w-16 py-1.5 pr-3 text-right font-semibold sm:w-24">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={`${f.season}-${f.division}`} className="border-t border-line align-top">
              <th scope="row" className="pl-3 text-left font-num text-[17px] font-bold text-navy">
                {yearLinks ? (
                  <Link href={`/championships/${f.season}`} className="inline-flex min-h-11 items-center hover:underline">
                    {f.season}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center">{f.season}</span>
                )}
              </th>
              <td className="py-0.5">
                <span className="flex items-center font-semibold">
                  <Team name={f.champion} link={link} />
                </span>
                <span className="flex items-center text-[14px] text-muted">
                  <span className="sr-only">Runner-up: </span>
                  <span aria-hidden="true" className="w-12 shrink-0 pr-2 text-right text-[13px]">over</span>
                  <Team name={f.runnerUp} link={link} crest={false} />
                </span>
                {/* On a phone a long note ("Mercy Rule-9:45 3rd Quarter") ran three lines down the narrow score column: it reads
                    here, under the teams, instead. One of the two copies is always display:none, so it is read once. */}
                {f.championScore != null && f.scoreNote && <span className="block pb-2 text-[13px] leading-tight text-muted sm:hidden">{f.scoreNote}</span>}
              </td>
              <td className="py-2 pr-3 text-right font-num text-[17px] tabular-nums text-ink">
                {f.championScore == null ? (
                  finalScore(f)
                ) : (
                  <>
                    {f.championScore}-{f.runnerUpScore}
                    {f.scoreNote && <span className="hidden font-sans text-[13px] leading-tight text-muted sm:block">{f.scoreNote}</span>}
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

/** Where a school's name goes (lib/final-linker.ts), and the successor map for title counts. */
export async function loadLinker() {
  const [alignments, identities, lineage] = await Promise.all([loadAlignments(), loadIdentities(), loadLineage()]);
  const successors = successorOf(lineage);
  const link = finalLinker(alignments, identities, successors);
  return { link, successors };
}
