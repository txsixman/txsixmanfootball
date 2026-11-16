import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adjacentYears, type Final, loadFinals } from "@/lib/champions";
import { championshipYearDescription } from "@/lib/descriptions";
import { CURRENT_SEASON } from "@/lib/season";
import { recordedFinals, stateChampionships } from "@/lib/state-championships";
import { championshipYearTitle } from "@/lib/titles";
import { Breadcrumbs } from "../../breadcrumbs";
import { PageHeader, SectionBar } from "../../ui";
import { Bracket, LeagueFinals, loadLinker, StateChampionshipTable } from "../shared";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ year: string }> };

/** One page for every season with a State Championship game (1972 on), and for this season from the day its State Championships
 * are set, before UIL's final is recorded. */
export async function generateStaticParams() {
  const [finals, recorded] = await Promise.all([loadFinals(), recordedFinals()]);
  return [...new Set([...finals.map((f) => f.season), ...recorded.map((f) => f.season), CURRENT_SEASON])].map((y) => ({ year: String(y) }));
}

/** This season's State Championship in every league (empty for a past season: its private leagues' finals come from `recordedFinals`). */
const setIn = async (year: string) => (Number(year) === CURRENT_SEASON ? stateChampionships(CURRENT_SEASON) : []);
const privateOf = async (year: string) => (await recordedFinals()).filter((f) => f.league !== "UIL" && String(f.season) === year);

const gamesOf = async (year: string) => (await loadFinals()).filter((f) => String(f.season) === year);
const twoDivisions = (games: Final[]) => games.some((g) => g.division);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year } = await params;
  const games = await gamesOf(year);
  // No UIL game on record yet (this season, before its final): the page speaks for every league.
  const all = !games.length;
  return {
    title: all ? `${year} six-man State Championships` : championshipYearTitle({ year: Number(year), divisions: twoDivisions(games) }),
    description: all
      ? `The ${year} six-man State Championships in UIL, TAPPS, TAIAO and TCAF: the teams, the day, and the champion and score once played.`
      : championshipYearDescription({ year: Number(year), games: games.map((g) => ({ division: g.division, teams: [g.champion, g.runnerUp] })) }),
    alternates: { canonical: `/championships/${year}` },
  };
}

export default async function ChampionshipYearPage({ params }: Props) {
  const { year } = await params;
  const [games, season, others] = await Promise.all([gamesOf(year), setIn(year), privateOf(year)]);
  if (!games.length && !season.length && !others.length) notFound();
  const { link } = await loadLinker();
  const { prev, next } = adjacentYears([...(await loadFinals()).map((f) => f.season), CURRENT_SEASON], Number(year));
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
          eyebrow={games.length ? "UIL six-man" : "Six-man"}
          title={`${year} State Championship`}
          note={
            !games.length
              ? "Every league's State Championship this season, each with its own page."
              : twoDivisions(games)
                ? "Division I and Division II, each a State Championship game."
                : "One state champion a year before Division I and Division II began in 2006."
          }
        />
        {season.length > 0 && <StateChampionshipTable id="every-league" title={`${year} State Championships`} aside="every league" items={season} link={link} />}
        {brackets.map((b) => (
          <Bracket key={b.id} {...b} link={link} yearLinks={false} />
        ))}
        {others.length > 0 && (
          <section aria-labelledby="private-leagues" className="mt-8">
            <SectionBar id="private-leagues" title="Private league State Championships" className="" />
            <LeagueFinals finals={others} link={link} yearLinks={false} />
          </section>
        )}
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
