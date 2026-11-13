import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadAlignments } from "@/lib/alignments";
import { fanSignIn } from "@/lib/auth/config";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { demoGames, type Game, type Team } from "@/lib/demo-games";
import { bracketGames, findGame, gameIds, gamePreview, longDate, resolveGame } from "@/lib/game-pages";
import { gameJsonLd } from "@/lib/json-ld";
import { orgOfLabel } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { currentPeriod, isForfeit, playedPeriods, winnerOf } from "@/lib/score-display";
import { Breadcrumbs } from "../../breadcrumbs";
import { JsonLd } from "../../json-ld";
import { ShareButton } from "../../share-button";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Comments } from "../comments";
import { ScoreReport } from "../score-report";
import { GoingInSection, MeetingsSection, ProjectionSection } from "../game-extras";
import { GamePreviewSection } from "../game-preview";
import { LiveScore } from "../live-score";
import { BigLine, Fact, Verification, type Program } from "../game-parts";
import { VerifyBar } from "../parts";
import { hasCard } from "./card/ids";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export const generateStaticParams = async () => (await gameIds()).map((id) => ({ id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await findGame(id);
  const g = found ? undefined : (await bracketGames()).find((x) => x.id === id);
  const teams = found ? found.result : g && { away: g.away.name, home: g.home.name };
  // This season's games share their own card (card/route.tsx); a past season's game shares the site's card.
  const card = (await hasCard(id)) && { openGraph: { images: [{ url: `/scores/${id}/card`, width: 1200, height: 630, alt: "Game card" }] } };
  // An invented sample game stays out of search (its schools are not real).
  return {
    title: teams ? `${teams.away} at ${teams.home}` : "Game",
    alternates: { canonical: `/scores/${id}` },
    ...card,
    ...(g && demoGames.includes(g) && { robots: { index: false } }),
  };
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
  const resolved = await resolveGame(id);
  if (!resolved) notFound();
  const { g, found, own, sample, detail, neutral } = resolved;
  // A bracket game not yet played gets a preview in place of "Going in" and "Earlier meetings" (it holds both).
  const preview =
    detail && g.date && !own && !sample && g.state === "scheduled"
      ? await gamePreview({ season: found?.season ?? CURRENT_SEASON, date: g.date, home: g.home.name, away: g.away.name, org: orgOfLabel(g.league), detail })
      : undefined;
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const programOf = (team: Team): Program | undefined => {
    const known = alignments.find((a) => a.school === team.name);
    return known && { slug: known.slug, identity: identities.get(known.slug) ?? EMPTY };
  };
  // Fan comments and score reports exist only while FAN_SIGNIN is "on" (read when the page is built; flip it and redeploy).
  const fan = fanSignIn();
  const live = g.state === "live";
  const winner = winnerOf(g);
  const back = sample ? { href: "/scores/sample", name: "Scoreboard" } : own ? { href: own.season === CURRENT_SEASON ? "/results" : `/results/${own.season}`, name: own.season === CURRENT_SEASON ? "Results" : `${own.season} results` } : { href: "/scores", name: "Scoreboard" };
  const places = [
    [g.away.name, detail?.places.away],
    [g.home.name, detail?.places.home],
  ].flatMap(([team, place]) => (place ? [[team, place]] : []));

  return (
    <article aria-labelledby="game-title">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }, back, { name: `${g.away.name} at ${g.home.name}`, href: `/scores/${id}` }]} />
      {!sample && <JsonLd data={gameJsonLd(g, { url: `${SITE_URL}/scores/${id}`, home: programOf(g.home), away: programOf(g.away) })} />}

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

      {/* A game with no final yet may be under way: its live score is read in the browser (ADR 0021). */}
      {!sample && g.date && g.state === "scheduled" && <LiveScore date={g.date} home={g.home.name} away={g.away.name} />}

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
          {preview ? (
            <GamePreviewSection preview={preview} detail={detail} projected={g.projected} programs={new Map(alignments.map((a) => [a.school, a.slug]))} />
          ) : (
            <>
              <GoingInSection away={g.away.name} home={g.home.name} detail={detail} />
              <MeetingsSection detail={detail} />
            </>
          )}
        </div>
      )}
      {!detail && <div className="pb-6" />}

      {fan && !sample && g.state === "scheduled" && <ScoreReport gameKey={id} away={g.away.name} home={g.home.name} date={g.date} />}

      {fan && !sample && (
        <div className="pb-6">
          <Comments gameKey={id} />
        </div>
      )}
    </article>
  );
}
