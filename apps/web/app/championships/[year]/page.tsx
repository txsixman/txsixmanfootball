import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adjacentYears, type Final, loadFinals } from "@/lib/champions";
import { championshipYearDescription } from "@/lib/descriptions";
import { championshipYearTitle } from "@/lib/titles";
import { Breadcrumbs } from "../../breadcrumbs";
import { PageHeader } from "../../ui";
import { Bracket, loadLinker } from "../shared";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ year: string }> };

/** One page for every season with a State Championship game (1972 on). */
export async function generateStaticParams() {
  return [...new Set((await loadFinals()).map((f) => f.season))].map((y) => ({ year: String(y) }));
}

const gamesOf = async (year: string) => (await loadFinals()).filter((f) => String(f.season) === year);
const twoDivisions = (games: Final[]) => games.some((g) => g.division);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year } = await params;
  const games = await gamesOf(year);
  return {
    title: championshipYearTitle({ year: Number(year), divisions: twoDivisions(games) }),
    description: championshipYearDescription({ year: Number(year), games: games.map((g) => ({ division: g.division, teams: [g.champion, g.runnerUp] })) }),
    alternates: { canonical: `/championships/${year}` },
  };
}

export default async function ChampionshipYearPage({ params }: Props) {
  const { year } = await params;
  const games = await gamesOf(year);
  if (!games.length) notFound();
  const { link } = await loadLinker();
  const { prev, next } = adjacentYears((await loadFinals()).map((f) => f.season), Number(year));
  const brackets = [
    { id: "division-1", title: "Division I", finals: games.filter((g) => g.division === "I") },
    { id: "division-2", title: "Division II", finals: games.filter((g) => g.division === "II") },
    { id: "one-division", title: "One division", finals: games.filter((g) => !g.division) },
  ].filter((b) => b.finals.length);
  const pill = "inline-flex min-h-11 items-center border-2 border-navy px-3 font-num text-[15px] font-bold uppercase tracking-wide text-navy hover:bg-panel";

  return (
    <>
      <div className="[&_ol]:px-0">
        <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "State Championships", href: "/championships" }, { name: year, href: `/championships/${year}` }]} />
      </div>
      <section aria-labelledby="championship-year" className="mt-4">
        <PageHeader
          id="championship-year"
          size="md"
          eyebrow="UIL six-man"
          title={`${year} State Championship`}
          note={twoDivisions(games) ? "Division I and Division II, each a State Championship game." : "One state champion a year before Division I and Division II began in 2006."}
        />
        {brackets.map((b) => (
          <Bracket key={b.id} {...b} link={link} yearLinks={false} />
        ))}
        <nav aria-label="Other years" className="mt-8 flex flex-wrap gap-2">
          {prev !== undefined && (
            <Link href={`/championships/${prev}`} className={pill}>
              <span aria-hidden="true">← </span>
              {prev}
            </Link>
          )}
          {next !== undefined && (
            <Link href={`/championships/${next}`} className={pill}>
              {next}
              <span aria-hidden="true"> →</span>
            </Link>
          )}
          <Link href="/championships" className={pill}>All State Championships</Link>
        </nav>
      </section>
    </>
  );
}
