import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAlignments } from "@/lib/alignments";
import { gameDescription } from "@/lib/descriptions";
import { fanSignIn } from "@/lib/auth/config";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { demoGames, type Game, type Team } from "@/lib/demo-games";
import { bracketGames, findGame, gameIds, gamePreview, longDate, mediumDate, playoffLabels, resolveGame } from "@/lib/game-pages";
import { gameKey } from "@/lib/games";
import { gameJsonLd } from "@/lib/json-ld";
import { orgOfLabel } from "@/lib/orgs";
import { CURRENT_SEASON, FIRST_SEASON } from "@/lib/season";
import { seriesHref } from "@/lib/series";
import { seriesPartners } from "@/lib/series-data";
import { projectedLine } from "@/lib/outcome";
import { currentPeriod, isForfeit, outcomeOf, playedPeriods } from "@/lib/score-display";
import { Breadcrumbs } from "../../breadcrumbs";
import { JsonLd } from "../../json-ld";
import { ShareButton } from "../../share-button";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Comments } from "../comments";
import { ScoreReport } from "../score-report";
import { GoingInSection, MeetingsSection, ProjectionSection } from "../game-extras";
import { GamePreviewSection } from "../game-preview";
import { GameKickoffStatus, GameLiveRead, GameScore } from "../live-game";
import { Fact, Verification, type Program } from "../game-parts";
import { VerifyBar } from "../parts";
import { hasCard } from "./card/ids";
import { gameTitle } from "@/lib/titles";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = false;

export const generateStaticParams = async () => (await gameIds()).map((id) => ({ id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await findGame(id);
  // A current-season playoff game's page is the bracket game's, whose result (if played) is `found`: it still has the round.
  const g = found?.result.id === id ? undefined : (await bracketGames()).find((x) => x.id === id);
  const teams = found ? found.result : g && { away: g.away.name, home: g.home.name };
  const sample = g !== undefined && demoGames.includes(g);
  const season = found?.season ?? CURRENT_SEASON;
  const date = found?.result.date ?? g?.date;
  // The round, by the label the page itself shows: the bracket game's, or a past season's playoff file.
  const playoff = sample ? undefined : (g?.league ?? (found && found.season !== CURRENT_SEASON ? (await playoffLabels(found.season)).get(gameKey(found.result.date, found.result.home, found.result.away)) : undefined));
  // This season's games share their own card (card/route.tsx); a past season's game shares the site's card.
  const card = (await hasCard(id)) && { openGraph: { images: [{ url: `/scores/${id}/card`, width: 1200, height: 630, alt: "Game card" }] } };
  // An invented sample game stays out of search (its schools are not real).
  return {
    // The date, or a playoff game's round and season, keeps each meeting's title its own: the same two teams meet again in
    // later seasons. A played final carries its score (away first, as the page shows it); a forfeit never does.
    title: teams
      ? gameTitle({
          away: teams.away,
          home: teams.home,
          date: date && mediumDate(date),
          scheduled: !found && g?.state === "scheduled",
          final: found && !sample && !found.result.forfeit ? { away: found.result.awayScore, home: found.result.homeScore } : undefined,
          round: playoff,
          season,
        })
      : "Game",
    ...(teams && { description: gameDescription({ away: teams.away, home: teams.home, date: date && mediumDate(date), season, playoff, scheduled: !found && g?.state === "scheduled", sample }) }),
    alternates: { canonical: `/scores/${id}` },
    ...card,
    ...(sample && { robots: { index: false } }),
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
              <th key={n} scope="col" className={`w-12 py-1 pr-2 font-semibold ${current === n ? "bg-band text-white" : ""}`}>
                {n}
                {current === n && <span className="sr-only"> (in progress)</span>}
              </th>
            ))}
            <th scope="col" className="w-14 bg-alert py-1 pr-2 font-bold text-white">
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
  // The two programs' series page, when they have met often enough to have one (lib/series.ts).
  const [awaySlug, homeSlug] = [programOf(g.away)?.slug, programOf(g.home)?.slug];
  const series = !sample && awaySlug && homeSlug && (await seriesPartners()).get(awaySlug)?.has(homeSlug) ? seriesHref(awaySlug, homeSlug) : undefined;
  // Fan comments and score reports exist only while FAN_SIGNIN is "on" (read when the page is built; flip it and redeploy).
  const fan = fanSignIn();
  const live = g.state === "live";
  const back = sample ? { href: "/scores/sample", name: "Scoreboard" } : own ? { href: own.season === CURRENT_SEASON ? "/results" : `/results/${own.season}`, name: own.season === CURRENT_SEASON ? "Results" : `${own.season} results` } : { href: "/scores", name: "Scoreboard" };
  const places = [
    [g.away.name, detail?.places.away],
    [g.home.name, detail?.places.home],
  ].flatMap(([team, place]) => (place ? [[team, place]] : []));

  return (
    <article aria-labelledby="game-title">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }, back, { name: `${g.away.name} vs ${g.home.name}`, href: `/scores/${id}` }]} />
      {!sample && <JsonLd data={gameJsonLd(g, { url: `${SITE_URL}/scores/${id}`, home: programOf(g.home), away: programOf(g.away) })} />}

      <GameLiveRead date={g.date} kickoff={g.kickoff} watch={!sample && !!g.date && g.state === "scheduled"}>
      <header>
        <div className={`flex items-center justify-between px-3 py-1.5 font-num text-[18px] font-bold uppercase tracking-wider text-white ${live ? "bg-alert" : "bg-band"}`}>
          <span>
            {live ? "Live" : g.status}
            {/* A real game not yet played: its kickoff status at the moment of viewing (ADR 0036). */}
            {!live && !sample && g.state === "scheduled" && g.date && (
              <>
                {" · "}
                <GameKickoffStatus g={{ ...g, date: g.date }} />
              </>
            )}
          </span>
          {live && <span>{g.status}</span>}
        </div>
        <VerifyBar g={g} />
        <h1 id="game-title" className="sr-only">
          {g.away.name} vs {g.home.name}
        </h1>
        <p className="px-3 pt-2 text-[12px] font-bold uppercase tracking-wider text-muted">
          {g.league}
          {sample && ". Sample game, invented schools."}
        </p>
        <ShareButton title={`${g.away.name} vs ${g.home.name} | ${SITE_NAME}`} className="px-3 pt-1" />
      </header>

      {/* A game with no final yet may be under way: its live score is read in the browser and shown in the big score (ADR 0021). */}
      <GameScore g={g} away={programOf(g.away)} home={programOf(g.home)} neutral={neutral} watch={!sample && !!g.date && g.state === "scheduled"} />
      </GameLiveRead>

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
          {/* What was projected before the game beside what happened (ADR 0044). A judged result shows it in its own section
              below, with how far the result was from it. No upset label. */}
          {g.projected && !(found && detail?.projection) && <Fact label="Projection"><span data-projected>{projectedLine(g.projected, outcomeOf(g))}</span>. A projection, not a result.</Fact>}
          <Fact label="Site">{g.venue}</Fact>
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
          {found && <ProjectionSection result={found.result} detail={detail} outcome={outcomeOf(g)} />}
          {preview ? (
            <GamePreviewSection preview={preview} detail={detail} projected={g.projected} programs={new Map(alignments.map((a) => [a.school, a.slug]))} />
          ) : (
            <>
              <GoingInSection away={g.away.name} home={g.home.name} detail={detail} />
              <MeetingsSection detail={detail} />
            </>
          )}
          {series && (
            <p className="px-3 pt-2">
              <Link href={series} prefetch={false} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-4 hover:text-red">
                Every {g.away.name} and {g.home.name} game since {FIRST_SEASON}
              </Link>
            </p>
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
