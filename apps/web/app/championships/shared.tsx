import { ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { type Final, finalScore } from "@/lib/champions";
import { finalLinker, type Linker } from "@/lib/final-linker";
import { gameDay } from "@/lib/game-day";
import { loadIdentities } from "@/lib/identity";
import { loadLineage, successorOf } from "@/lib/lineage";
import type { StateChampionship } from "@/lib/state-championships";
import type { LeagueFinal } from "@/lib/state-finals";
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

const SCORE_CELL = "py-2 pr-3 text-right font-num text-[17px] tabular-nums text-ink";

/** A side of a State Championship still to be set reads as the bracket words it ("Winner of G29"). */
function Side({ side, link, crest = true }: { side: StateChampionship["sides"][number]; link: Linker; crest?: boolean }) {
  return side.team ? <Team name={side.team} link={link} crest={crest} /> : <span className="inline-flex min-h-11 items-center text-muted">{side.text}</span>;
}

/** One season's State Championship in every bracket it was set in (ADR 0083): the champion, runner-up and score once a final
 * is recorded, the two sides and the day before. Each bracket links to its State Championship page. */
export function StateChampionshipTable({ id, title, aside, items, link }: { id: string; title: string; aside?: string; items: StateChampionship[]; link: Linker }) {
  return (
    <section aria-labelledby={id} className="mt-8 scroll-mt-4">
      <SectionBar id={id} title={title} aside={aside} className="" />
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">{title}, one row for each bracket</caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="w-28 py-1.5 pl-3 text-left font-semibold sm:w-48">Bracket</th>
            <th scope="col" className="py-1.5 text-left font-semibold">Teams</th>
            <th scope="col" className="w-20 py-1.5 pr-3 text-right font-semibold sm:w-28">Score or day</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.slug} className="border-t border-line align-top">
              <th scope="row" className="pl-3 text-left align-top text-[15px] font-bold leading-5 text-navy">
                <Link href={c.href} className="inline-flex min-h-11 items-center hover:underline">
                  {c.bracket}
                  <span className="sr-only"> State Championship</span>
                </Link>
              </th>
              <td className="py-0.5">
                {c.final ? (
                  <>
                    <span className="flex items-center font-semibold">
                      <Trophy aria-hidden="true" className="mr-1 size-4 shrink-0 text-red" />
                      <span className="sr-only">Champion: </span>
                      <Team name={c.final.champion} link={link} />
                    </span>
                    <span className="flex items-center text-[14px] text-muted">
                      <span className="sr-only">Runner-up: </span>
                      <span aria-hidden="true" className="w-12 shrink-0 pr-2 text-right text-[13px]">over</span>
                      <Team name={c.final.runnerUp} link={link} crest={false} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center font-semibold">
                      <Side side={c.sides[0]} link={link} />
                    </span>
                    <span className="flex items-center text-[14px] text-muted">
                      <span aria-hidden="true" className="w-12 shrink-0 pr-2 text-right text-[13px]">vs</span>
                      <Side side={c.sides[1]} link={link} crest={false} />
                    </span>
                  </>
                )}
              </td>
              <td className={SCORE_CELL}>
                {c.final ? (
                  c.final.forfeit ? "Forfeit" : `${c.final.championScore}-${c.final.runnerUpScore}`
                ) : c.scores ? (
                  <span className="font-sans text-[13px] leading-tight text-muted">Score not confirmed yet</span>
                ) : (
                  c.date && <span className="font-sans text-[14px] leading-tight text-muted">{gameDay(c.date)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The private leagues' recorded State Championships, one table a league, newest first. The leagues have no archive here:
 * a recorded final is their record. Same look as the UIL tables above. */
export function LeagueFinals({ finals, link, yearLinks = true }: { finals: LeagueFinal[]; link: Linker; yearLinks?: boolean }) {
  const leagues = [...new Set(finals.map((f) => f.league))].sort();
  return (
    <>
      {leagues.map((league) => {
        const rows = finals.filter((f) => f.league === league).sort((a, b) => b.season - a.season || a.bracket.localeCompare(b.bracket));
        const id = `league-${league.toLowerCase()}`;
        const years = rows.map((f) => f.season);
        return (
          <section key={league} aria-labelledby={id} className="mt-6">
            <h3 id={id} className="flex items-baseline justify-between border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
              {league}
              <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">
                {Math.min(...years) === Math.max(...years) ? Math.min(...years) : `${Math.min(...years)} to ${Math.max(...years)}`}
              </span>
            </h3>
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">{league} State Championship {rows.length > 1 ? "games, newest first" : "game"}</caption>
              <thead>
                <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
                  <th scope="col" className="w-16 py-1.5 pl-3 text-left font-semibold">Season</th>
                  <th scope="col" className="py-1.5 text-left font-semibold">Champion and runner-up</th>
                  <th scope="col" className="w-16 py-1.5 pr-3 text-right font-semibold sm:w-24">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={`${f.season}-${f.bracket}`} className="border-t border-line align-top">
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
                      {f.bracket !== league && <span className="block pb-2 pl-12 text-[13px] leading-tight text-muted">{f.bracket.slice(league.length).trim()}</span>}
                    </td>
                    <td className={SCORE_CELL}>{f.forfeit ? "Forfeit" : `${f.championScore}-${f.runnerUpScore}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}

/** A bracket's link to its State Championship page (ADR 0083): "<champion>, 2026 State Champion" with the score once a final
 * is recorded, else "State Championship" with the two sides and the day. */
export function StateChampionshipLink({ c, className = "" }: { c: StateChampionship; className?: string }) {
  const f = c.final;
  const score = f && !f.forfeit ? `${f.championScore}-${f.runnerUpScore}` : undefined;
  return (
    <Link href={c.href} className={`flex min-h-11 items-center justify-between gap-2 px-3 py-1 hover:bg-panel ${className}`}>
      <span className="min-w-0">
        {f ? (
          <>
            <span className="flex items-center gap-1.5 font-num text-[18px] font-bold uppercase leading-tight tracking-wide text-navy">
              <Trophy aria-hidden="true" className="size-4 shrink-0 text-red" />
              {f.champion}, {c.season} State Champion
            </span>
            <span className="block text-[14px] leading-5 text-muted">
              {score ? `${score} over ${f.runnerUp}` : `Over ${f.runnerUp} (forfeit)`}
            </span>
          </>
        ) : (
          <>
            <span className="block font-num text-[16px] font-bold uppercase tracking-wide text-navy">State Championship</span>
            <span className="block text-[14px] leading-5 text-muted">
              {c.sides.map((s) => s.text).join(" vs ")}
              {c.date && ` · ${gameDay(c.date)}`}
            </span>
          </>
        )}
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-navy" />
    </Link>
  );
}
