import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAlignments } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { demoGames, type Game, type Team } from "@/lib/demo-games";
import { findGame, gameDetail, longDate, resultAsGame, resultPageIds } from "@/lib/game-pages";
import { loadGames } from "@/lib/games";
import { memo } from "@/lib/memo";
import { CURRENT_SEASON } from "@/lib/season";
import { currentPeriod, isForfeit, playedPeriods, winnerOf } from "@/lib/score-display";
import { ShareButton } from "../../share-button";
import { SITE_NAME } from "@/lib/site";
import { GoingInSection, MeetingsSection, ProjectionSection } from "../game-extras";
import { BigLine, Fact, Verification, type Program } from "../game-parts";
import { VerifyBar } from "../parts";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = false;

/** The bracket games of the season (hand captures and robot-read), then the invented sample games. Read once per worker:
 * every robot-read game of every season has a page too, and would otherwise read these files again. */
const bracketGames = memo<void, Game[]>(async () => [...(await loadGames(await loadAlignments())), ...demoGames]);

/** One address per game: bracket and sample games, then every robot-read game that is not also a bracket game (lib/game-pages.ts). */
export const generateStaticParams = async () => [...new Set([...(await bracketGames()).map((g) => g.id), ...(await resultPageIds())])].map((id) => ({ id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await findGame(id);
  const g = found ? undefined : (await bracketGames()).find((x) => x.id === id);
  const teams = found ? found.result : g && { away: g.away.name, home: g.home.name };
  return { title: teams ? `${teams.away} at ${teams.home}` : "Game" };
}

function Linescore({ g }: { g: Game }) {
  if (!g.quarters) return null;
  const current = currentPeriod(g);
  const played = playedPeriods(g);
  const rows = [
    { team: g.away, nums: g.quarters.away, total: g.awayScore },
    { team: g.home, nums: g.quarters.home, total: g.homeScore },
  ];
  return (
    <section aria-labelledby="by-quarter" className="mt-5 px-3">
      <h2 id="by-quarter" className="mb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        Score by quarter
      </h2>
      <table className="w-full border-collapse text-right font-num">
        <thead>
          <tr className="border-y-2 border-navy text-[14px] uppercase tracking-wide text-muted">
            <th scope="col" className="py-1 text-left">
              <span className="sr-only">Team</span>
            </th>
            {[1, 2, 3, 4].map((n) => (
              <th key={n} scope="col" className={`w-12 py-1 pr-2 font-semibold ${current === n ? "bg-navy text-white" : ""}`}>
                {n}
                {current === n && <span className="sr-only"> (in progress)</span>}
              </th>
            ))}
            <th scope="col" className="w-14 bg-red py-1 pr-2 font-bold text-white">
              T<span className="sr-only">otal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, nums, total }) => (
            <tr key={team.name} className="border-b border-line">
              <th scope="row" className="py-2 text-left text-[18px] font-bold uppercase tracking-wide text-ink">
                {team.initials}
                <span className="sr-only"> {team.name}</span>
              </th>
              {nums.map((n, i) => (
                <td key={i} className={`py-2 pr-2 text-[22px] font-semibold ${i < played ? "text-ink" : "text-muted"} ${current === i + 1 ? "bg-panel" : ""}`}>
                  {i < played ? n : <><span aria-hidden="true">&ndash;</span><span className="sr-only">not played</span></>}
                </td>
              ))}
              <td className="py-2 pr-2 text-[26px] font-bold text-red">{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function GamePage({ params }: Props) {
  const { id } = await params;
  // A robot-read game, which is also a bracket game's result when it is a current-season playoff game.
  const found = await findGame(id);
  const own = found?.result.id === id ? found : undefined;
  const bracket = own ? undefined : (await bracketGames()).find((x) => x.id === id);
  if (!own && !bracket) notFound();
  const sample = bracket !== undefined && demoGames.includes(bracket);
  const date = own?.result.date ?? bracket?.date;
  const detail =
    !sample && date
      ? await gameDetail({
          season: found?.season ?? CURRENT_SEASON,
          date,
          home: own?.result.home ?? bracket!.home.name,
          away: own?.result.away ?? bracket!.away.name,
          id: found?.result.id,
        })
      : undefined;
  const g: Game = own ? resultAsGame(own, detail!) : bracket!;
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const programOf = (team: Team): Program | undefined => {
    const known = alignments.find((a) => a.school === team.name);
    return known && { slug: known.slug, identity: identities.get(known.slug) ?? EMPTY };
  };
  const live = g.state === "live";
  const winner = winnerOf(g);
  // A past season's playoff game has no site on record: neither team is called home or away.
  const neutral = own !== undefined && detail?.playoff !== undefined;
  const back = sample ? { href: "/scores/sample", label: "Scoreboard" } : own ? { href: own.season === CURRENT_SEASON ? "/results" : `/results/${own.season}`, label: "Results" } : { href: "/scores", label: "Scoreboard" };
  const places = [
    [g.away.name, detail?.places.away],
    [g.home.name, detail?.places.home],
  ].flatMap(([team, place]) => (place ? [[team, place]] : []));

  return (
    <article aria-labelledby="game-title">
      <nav aria-label="Back" className="border-b border-line">
        <Link href={back.href} className="flex min-h-11 items-center gap-1.5 px-3 text-[14px] font-semibold text-navy focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy">
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2.5} />
          {back.label}
        </Link>
      </nav>

      <header>
        <div className={`flex items-center justify-between px-3 py-1.5 font-num text-[18px] font-bold uppercase tracking-wider text-white ${live ? "bg-red" : "bg-navy"}`}>
          <span>{live ? "Live" : g.status}</span>
          {live && <span>{g.status}</span>}
        </div>
        <VerifyBar g={g} />
        <h1 id="game-title" className="sr-only">
          {g.away.name} at {g.home.name}
        </h1>
        <p className="px-3 pt-2 text-[12px] font-bold uppercase tracking-wider text-muted">
          {g.league}
          {sample && ". Sample game, invented schools."}
        </p>
        <ShareButton title={`${g.away.name} at ${g.home.name} | ${SITE_NAME}`} className="px-3 pt-1" />
      </header>

      <section aria-label="Score" className="px-3">
        <BigLine g={g} side="away" program={programOf(g.away)} neutral={neutral} />
        <BigLine g={g} side="home" program={programOf(g.home)} neutral={neutral} />
      </section>

      <Linescore g={g} />

      <section aria-labelledby="details" className="mt-5 px-3 pb-1">
        <h2 id="details" className="mb-0.5 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
          Game details
        </h2>
        <dl>
          {g.date && !sample && <Fact label="Date">{longDate(g.date)}</Fact>}
          {g.verification !== "none" && (
            <Fact label="Verified">
              <Verification g={g} />
            </Fact>
          )}
          {isForfeit(g) && (
            <Fact label="How it ended">
              Forfeit. No score was played.
            </Fact>
          )}
          {g.endReason && !isForfeit(g) && <Fact label={g.state === "postponed" ? "Why" : "How it ended"}>{g.endReason}</Fact>}
          {g.upset && winner && <Fact label="Upset">{g[winner].name} won after being projected to lose.</Fact>}
          {g.projected && <Fact label="Projected">{g.projected}. A projection, not a result.</Fact>}
          <Fact label="Venue">{g.venue}</Fact>
          {places.length > 0 && (
            <Fact label="Plays in">
              {places.map(([team, place]) => (
                <span key={team} className="block">
                  {team}: {place}
                </span>
              ))}
            </Fact>
          )}
          {g.stream && <Fact label="Listen or watch">{g.stream}</Fact>}
        </dl>
      </section>

      {detail && (
        <div className="pb-6">
          {found && <ProjectionSection result={found.result} detail={detail} />}
          <GoingInSection away={g.away.name} home={g.home.name} detail={detail} />
          <MeetingsSection detail={detail} />
        </div>
      )}
      {!detail && <div className="pb-6" />}
    </article>
  );
}
