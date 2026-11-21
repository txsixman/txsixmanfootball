import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addressLine } from "@/lib/address";
import { loadBrackets } from "@/lib/brackets";
import { stateChampionshipDescription } from "@/lib/descriptions";
import { kickoffTime } from "@/lib/kickoff";
import { gamesOf } from "@/lib/playoff-path";
import { plural } from "@/lib/plural";
import { chanceText, projectionParts } from "@/lib/projection";
import { loadRatings, record } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { slugify } from "@/lib/slug";
import { stateChampionships, type StateChampionship } from "@/lib/state-championships";
import { STATE_ROUNDS } from "@/lib/state-finals";
import { titleHistory } from "@/lib/title-history";
import { stateChampionshipTitle } from "@/lib/titles";
import { longDate, mediumDate } from "@/lib/game-pages";
import { Breadcrumbs } from "../../../breadcrumbs";
import { Fact } from "../../../scores/game-parts";
import { PageHeader, SectionBar } from "../../../ui";
import { loadLinker, Team } from "../../shared";
import { championshipCardTags } from "./card/championship-card";

// One league bracket's State Championship this season, /championships/<season>/<bracket>: the game before it is played (teams,
// kickoff, site, projected margin and chance to win), the result after (champion, score, runner-up), and for each team its
// playoff path, season record and State Championship history. Words: "State Championship" always; "Final" only as a score
// status. Never a forfeit's score, never a champion while the result is not confirmed.

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ year: string; bracket: string }> };

export async function generateStaticParams() {
  return (await stateChampionships(CURRENT_SEASON)).map((c) => ({ year: String(c.season), bracket: c.slug }));
}

const find = async ({ year, bracket }: { year: string; bracket: string }) =>
  (await stateChampionships(CURRENT_SEASON)).find((c) => String(c.season) === year && c.slug === bracket);

const knownTeams = (c: StateChampionship) => c.sides.flatMap((s) => (s.team ? [s.team] : []));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await find(await params);
  if (!c) return { title: "State Championship" };
  return {
    title: stateChampionshipTitle({ season: c.season, bracket: c.bracket }),
    description: stateChampionshipDescription({
      season: c.season,
      bracket: c.bracket,
      teams: c.sides.map((s) => s.text),
      date: c.date && mediumDate(c.date),
      played: Boolean(c.final || c.scores),
    }),
    alternates: { canonical: c.href },
    ...(await championshipCardTags(String(c.season), c.slug)),
  };
}

const linkClass = "inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-4 hover:text-red";

/** What a team's playoff game says: W or L only for a confirmed played game, "Forfeit" for a forfeit (never its score). */
function Result({ g, home }: { g: { homeScore?: number; awayScore?: number; forfeit: boolean; confirmed: boolean }; home: boolean }) {
  if (g.homeScore == null || g.awayScore == null) return <span className="text-muted">Not played yet</span>;
  if (g.forfeit) return <>Forfeit</>;
  const [us, them] = home ? [g.homeScore, g.awayScore] : [g.awayScore, g.homeScore];
  const score = `${us}-${them}`;
  if (!g.confirmed) return <>{score}, not confirmed</>;
  if (us === them) return <>Tied {score}</>;
  return (
    <>
      <span aria-hidden="true" className="mr-1.5 font-bold">{us > them ? "W" : "L"}</span>
      <span className="sr-only">{us > them ? "Won" : "Lost"} </span>
      {score}
    </>
  );
}


export default async function StateChampionshipPage({ params }: Props) {
  const c = await find(await params);
  if (!c) notFound();
  const teams = knownTeams(c);
  const { link } = await loadLinker();
  const title = `${c.season} ${c.bracket} State Championship`;
  const unresolved = !c.final && c.scores !== undefined;

  // Each known team's playoff results this season, State Championship excluded, in round order.
  const bracket = (await loadBrackets(c.season)).find((b) => b.name === c.bracket);
  const paths = teams.map((team) => ({
    team,
    games: bracket ? gamesOf(bracket.rounds, team).filter((p) => !STATE_ROUNDS.has(p.round)) : [],
  }));

  // The same season record the program page shows (the ratings table's won-lost).
  const rows = new Map((await loadRatings(c.season)).teams.map((t) => [slugify(t.team), t]));
  const records = teams.flatMap((team) => {
    const row = rows.get(slugify(team));
    return row ? [{ team, record: record(row) }] : [];
  });

  // Past State Championships: UIL's archive (with recorded finals), or the private leagues' recorded finals. This game is left out.
  const history = await titleHistory(c.league, teams, c.season);

  const matchup = (
    <ul className="mt-3 divide-y divide-line border-y border-line">
      {c.sides.map((s, i) => (
        <li key={i} className="flex min-h-14 items-center px-3 py-1 text-[17px] font-semibold">
          {s.team ? <Team name={s.team} link={link} /> : <span className="inline-flex min-h-11 items-center pl-12 text-muted">{s.text}</span>}
        </li>
      ))}
    </ul>
  );

  const links = (
    <p className="mt-3 flex flex-wrap gap-x-5 px-3">
      <Link href={c.bracketHref} className={linkClass}>Full bracket</Link>
      {c.gameHref && <Link href={c.gameHref} className={linkClass}>Game page</Link>}
    </p>
  );

  return (
    <>
      <div className="[&_ol]:px-0">
        <Breadcrumbs
          trail={[
            { name: "Home", href: "/" },
            { name: "State Championships", href: "/championships" },
            { name: title, href: c.href },
          ]}
        />
      </div>
      <section aria-labelledby="state-championship" className="mt-4">
        <PageHeader id="state-championship" size="md" eyebrow={`${c.league} six-man`} title={title} />

        {c.final ? (
          <section aria-labelledby="result" className="mt-8">
            <SectionBar id="result" title="Result" aside={c.final.date ? mediumDate(c.final.date) : undefined} className="" />
            <p data-champion className="flex flex-wrap items-center px-3 pt-3 text-[22px] font-bold leading-7 text-navy">
              <Team name={c.final.champion} link={link} />
              <span className="whitespace-pre-wrap">, {c.season} {c.bracket} State Champion</span>
            </p>
            <dl className="px-3">
              <Fact label="Final score">
                <span className="font-num text-[20px] font-bold tabular-nums">{c.final.forfeit ? "Forfeit" : `${c.final.championScore}-${c.final.runnerUpScore}`}</span>
              </Fact>
              <Fact label="Runner-up">
                <Team name={c.final.runnerUp} link={link} />
              </Fact>
              {c.final.date && <Fact label="Date">{longDate(c.final.date)}</Fact>}
              {c.site && <Fact label="Site">{c.site}{c.address && <span className="block">{addressLine(c.address)}</span>}</Fact>}
            </dl>
            {links}
          </section>
        ) : (
          <section aria-labelledby="matchup" className="mt-8">
            <SectionBar id="matchup" title={unresolved ? "Result not confirmed" : "The game"} className="" />
            {matchup}
            {unresolved && (
              <p className="px-3 pt-3 text-[15px] text-ink">
                Scores as listed: {c.sides[0].text} {c.scores![0]}, {c.sides[1].text} {c.scores![1]}. This result is not confirmed, so no champion is named yet.
              </p>
            )}
            <dl className="mt-1 px-3">
              {c.date && (
                <Fact label={!unresolved && c.kickoff ? "Kickoff" : "Date"}>
                  {longDate(c.date)}
                  {!unresolved && c.kickoff && <span className="block font-semibold">{kickoffTime(c.kickoff)}</span>}
                </Fact>
              )}
              {c.site && (
                <Fact label="Site">
                  {c.site}
                  {c.address && <span className="block">{addressLine(c.address)}</span>}
                  {c.directions && (
                    <a href={c.directions} rel="noopener noreferrer" className={linkClass} data-directions>
                      Directions<span className="sr-only"> to {c.site.replace(/ \(home\)$/, "")}, a map search</span>
                    </a>
                  )}
                </Fact>
              )}
              {!unresolved && c.projection && (
                <>
                  <Fact label="Projected margin">{projectionParts(c.projection).margin}</Fact>
                  <Fact label="Chance to win">
                    {c.projection.favorite}: {chanceText(c.projection.winProbability)}
                    <span className="block text-[13px] text-muted">A projection, not a result.</span>
                  </Fact>
                </>
              )}
            </dl>
            {links}
          </section>
        )}

        {records.length > 0 && (
          <section aria-labelledby="records" className="mt-8">
            <SectionBar id="records" title={`${c.season} records`} className="" />
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">{c.season} season record of each team in the {c.bracket} State Championship</caption>
              <thead>
                <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
                  <th scope="col" className="py-1.5 pl-3 text-left font-semibold">Team</th>
                  <th scope="col" className="w-24 py-1.5 pr-3 text-right font-semibold">Record</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.team} className="border-t border-line">
                    <th scope="row" className="py-0.5 pl-3 text-left font-semibold"><Team name={r.team} link={link} /></th>
                    <td className="py-2 pr-3 text-right font-num text-[17px] font-semibold tabular-nums text-ink">{r.record}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {teams.length > 0 && (
          <section aria-labelledby="paths" className="mt-8">
            <SectionBar id="paths" title={`${c.season} playoff path`} className="" />
            {paths.map(({ team, games }) => (
              <div key={team} className="mt-4">
                <h3 className="px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy">{team}</h3>
                {games.length ? (
                  <table className="w-full border-collapse text-[15px]">
                    <caption className="sr-only">{team}&apos;s {c.season} playoff results before the State Championship</caption>
                    <thead>
                      <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
                        <th scope="col" className="w-28 py-1.5 pl-3 text-left font-semibold">Round</th>
                        <th scope="col" className="py-1.5 text-left font-semibold">Opponent</th>
                        <th scope="col" className="w-32 py-1.5 pr-3 text-right font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((p) => (
                        <tr key={`${p.round}-${p.opponent}`} className="border-t border-line">
                          <th scope="row" className="py-2 pl-3 text-left font-normal text-ink">{p.label}</th>
                          <td className="py-0.5"><Team name={p.opponent} link={link} crest={false} /></td>
                          <td className="py-2 pr-3 text-right font-num tabular-nums text-ink"><Result g={p.game} home={p.home} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-2 text-[15px] text-muted">No earlier playoff games on record this season.</p>
                )}
              </div>
            ))}
          </section>
        )}

        {teams.length > 0 && (
          <section aria-labelledby="history" className="mt-8">
            <SectionBar id="history" title="State Championship history" aside={`Before ${c.season}`} className="" />
            {history.map(({ team, past, titles }) => (
              <div key={team} className="mt-4">
                <h3 className="px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy">{team}</h3>
                {past.length ? (
                  <>
                    <p className="px-3 pt-1 text-[15px] font-semibold text-ink">{titles ? plural(titles, "state title") : "No state titles"}, {plural(past.length, "State Championship appearance")}</p>
                    <table className="w-full border-collapse text-[15px]">
                      <caption className="sr-only">{team}&apos;s earlier State Championships, newest first</caption>
                      <thead>
                        <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
                          <th scope="col" className="w-16 py-1.5 pl-3 text-left font-semibold">Season</th>
                          <th scope="col" className="py-1.5 text-left font-semibold">Opponent</th>
                          <th scope="col" className="w-28 py-1.5 pr-3 text-right font-semibold">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {past.map((a) => (
                          <tr key={`${a.season}-${a.bracket}`} className="border-t border-line">
                            <th scope="row" className="py-2 pl-3 text-left font-num text-[16px] font-bold text-navy">{a.season}</th>
                            <td className="py-0.5">
                              <Team name={a.opponent} link={link} crest={false} />
                              {a.bracket !== c.bracket && <span className="block pb-1 text-[13px] text-muted">{a.bracket}</span>}
                            </td>
                            <td className="py-2 pr-3 text-right font-num tabular-nums text-ink">
                              <span aria-hidden="true" className="mr-1.5 font-bold">{a.won ? "W" : "L"}</span>
                              <span className="sr-only">{a.won ? "Won" : "Lost"} </span>
                              {a.score ?? "No score listed"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="px-3 py-2 text-[15px] text-ink">First State Championship appearance</p>
                )}
              </div>
            ))}
          </section>
        )}
      </section>
    </>
  );
}
