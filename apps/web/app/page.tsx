import type { Metadata } from "next";
import Link from "next/link";
import { loadAlignments, slugify } from "@/lib/alignments";
import { loadBrackets } from "@/lib/brackets";
import { homeDescription } from "@/lib/descriptions";
import { loadGames } from "@/lib/games";
import { loadFinals } from "@/lib/champions";
import { nightTitle } from "@/lib/game-night";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { loadRanked, type Ranked } from "@/lib/rankings";
import { FEW_GAMES, signed } from "@/lib/ratings";
import { ORGS, orgHref, type Org } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { loadTitleChances } from "@/lib/title-chances";
import { loadNight } from "@/lib/tonight";
import { weekHref } from "@/lib/week-review-hrefs";
import { latestReview } from "@/lib/week-review-load";
import { MyTeams } from "./my-teams/block";
import { ChanceList } from "./playoffs/chance-list";
import { Crest } from "./programs/crest";

export const dynamic = "force-static";
export const metadata: Metadata = { description: homeDescription(CURRENT_SEASON, ORGS.map((o) => o.label)) };

const TOP = 5; // UIL's two divisions
const TOP_PRIVATE = 3; // each smaller organization
const WATCH = 3; // closest games per organization

// Organizations never share a list (ADR 0012): every block below is one organization, or one UIL division.
const orgOfGame = (league: string): Org | undefined => ORGS.find((o) => league === o.league || league.startsWith(`${o.league} `));

function Top({ title, href, teams, identities }: {
  title: string; href: string; teams: (Ranked & { rank: number })[]; identities: Awaited<ReturnType<typeof loadIdentities>>;
}) {
  return (
    <section aria-labelledby={`top-${slugify(title)}`} className="min-w-0">
      <h3 id={`top-${slugify(title)}`} className="sub-title">
        {title}
      </h3>
      <ol>
        {teams.map((t) => (
          <li key={t.team} className="flex items-center gap-2 border-b border-line">
            <span className="w-6 text-right font-num text-[17px] font-semibold text-muted">{t.rank}</span>
            <Link href={`/programs/${t.school.slug}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-ink hover:text-navy hover:underline">
              <Crest school={t.school.school} identity={identities.get(t.school.slug) ?? EMPTY} size={24} decorative />
              <span className="truncate">{t.school.school}</span>
            </Link>
            <span className="font-num text-[18px] font-bold tabular-nums text-navy">{signed(t.rating)}</span>
          </li>
        ))}
      </ol>
      <Link href={href} className="link-more">
        Full {title} rankings
      </Link>
    </section>
  );
}

export default async function Home() {
  const [ranked, finals, identities, alignments, chances, tonight, review, brackets] = await Promise.all([
    loadRanked(), loadFinals(), loadIdentities(), loadAlignments(), loadTitleChances(), loadNight(), latestReview(), loadBrackets(),
  ]);
  // This round's page is linked while a playoff game is still to be played (app/playoffs/this-round).
  const playoffsOn = brackets.some((b) => b.rounds.some((r) => r.games.some((g) => g.homeScore == null && !g.forfeit)));
  const current = new Set(alignments.map((a) => a.slug));
  // The closest projected games still to play in each organization: the ones most worth watching.
  // A game dated before tonight with no score yet is waiting on its score, not still to play: it is left out.
  const upcoming = (await loadGames(alignments))
    .filter((g) => g.state === "scheduled" && g.projectedMargin != null && !(g.date && g.date < tonight.night))
    .sort((a, b) => a.projectedMargin! - b.projectedMargin!);
  const watch = ORGS.map((org) => ({ org, games: upcoming.filter((g) => orgOfGame(g.league) === org).slice(0, WATCH) })).filter((w) => w.games.length);
  // Ranks counted inside the list shown: teams arrive best first.
  const top = (keep: (t: Ranked) => boolean, n: number) => ranked.teams.filter((t) => t.rated >= FEW_GAMES && keep(t)).slice(0, n).map((t, i) => ({ ...t, rank: i + 1 }));
  const tops = [
    { title: "UIL Division I", href: "/rankings/division-1", teams: top((t) => t.school.league === "UIL" && t.school.division === "I", TOP) },
    { title: "UIL Division II", href: "/rankings/division-2", teams: top((t) => t.school.league === "UIL" && t.school.division === "II", TOP) },
    ...ORGS.slice(1).map((org) => ({ title: org.label, href: orgHref("/rankings", org), teams: top((t) => t.school.league === org.league, TOP_PRIVATE) })),
  ].filter((t) => t.teams.length > 1); // a one-team "top" is no ranking (Independent starts with one program)
  const latest = Math.max(...finals.map((f) => f.season));
  const reigning = finals.filter((f) => f.season === latest).sort((a, b) => a.division.localeCompare(b.division));

  return (
    <>
      <p className="kicker">{ranked.season} season</p>
      <h1 className="page-title mt-1">Texas six-man football</h1>
      <p className="mt-2 text-[14px] text-muted">
        {ranked.teams.length} rated teams in UIL, TAPPS, TAIAO, TCAF and independent programs. Each organization has its own rankings, standings and
        brackets.
      </p>

      <MyTeams />

      {/* Tonight is linked only when the night has games, this round only while a playoff game is still to play, and the week in review is the newest week with a game: both decided when the site is built. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {tonight.count > 0 && (
          <Link href="/scores/tonight" className="btn w-full sm:w-auto">
            Tonight, {nightTitle(tonight.night)}: {tonight.count} {tonight.count === 1 ? "game" : "games"}
          </Link>
        )}
        {playoffsOn && (
          <Link href="/playoffs/this-round" className="btn w-full sm:w-auto">
            Playoffs: this round
          </Link>
        )}
        {review && (
          <Link href={weekHref(review.season, review.week)} className="btn w-full sm:w-auto">
            Week in review: {review.season} week {review.week}
          </Link>
        )}
      </div>

      {watch.length > 0 && (
        <section aria-labelledby="watch" className="mt-6">
          <h2 id="watch" className="section-title">Games to watch</h2>
          <p className="section-note">The closest playoff games still to play in each organization, by projected margin, with the projected team&rsquo;s chance to win.</p>
          {watch.map(({ org, games }) => (
            <section key={org.slug} aria-labelledby={`watch-${org.slug}`} className="mt-3">
              <h3 id={`watch-${org.slug}`} className="sub-title">{org.label}</h3>
              <ul>
                {games.map((g) => {
                  const [day, date] = g.status.split(" ");
                  return (
                    <li key={g.id} className="border-b border-line">
                      <Link href={`/scores/${g.id}`} className="flex min-h-16 items-center gap-3 py-2 hover:bg-panel">
                        <span className="w-12 shrink-0 text-center font-num font-bold uppercase leading-tight text-navy">
                          <span className="block text-[13px] text-red">{day}</span>
                          <span className="block text-[18px]">{date}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold leading-snug text-ink">
                            {g.away.name} vs {g.home.name}
                          </span>
                          <span className="block text-[13px] text-muted">{g.league}</span>
                          <span className="block text-[13px] font-semibold text-navy">
                            {g.projected?.replace(/ chance to win$/, "")}
                            <span className="sr-only"> chance to win</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <div className="flex flex-wrap gap-x-5">
            <Link href="/scores" className="link-more">Playoff scores</Link>
            <Link href="/playoffs/this-round" className="link-more">This round</Link>
            <Link href="/playoffs" className="link-more">Playoff brackets</Link>
          </div>
        </section>
      )}

      <section aria-labelledby="top" className="mt-8">
        <h2 id="top" className="section-title">Rankings</h2>
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          {tops.map((t) => (
            <Top key={t.href} title={t.title} href={t.href} teams={t.teams} identities={identities} />
          ))}
        </div>
        <Link href="/matchup" className="btn mt-3 w-full sm:w-auto">
          Matchup: compare any two teams
        </Link>
      </section>

      {chances.state.length > 0 && (
        <section aria-labelledby="chances" className="mt-8">
          <h2 id="chances" className="section-title">State title chances</h2>
          <p className="section-note">
            Each team&rsquo;s chance to win its state title from here, from each game&rsquo;s projection. Shown once a bracket is down
            to its last four, or once every region of a UIL division is set and the semifinal pairings are known.
          </p>
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            {chances.state.map((b) => (
              <ChanceList key={b.bracket} id={`c-${slugify(b.bracket)}`} title={`${b.bracket} · ${b.round === "final" ? "Final" : b.round === "semifinal" ? "Semifinals" : "Regional round"}`} chances={b.chances} identities={identities} />
            ))}
          </div>
        </section>
      )}

      {chances.regions.length > 0 && (
        <section aria-labelledby="region-chances" className="mt-8">
          <h2 id="region-chances" className="section-title">Region title chances</h2>
          <p className="section-note">
            Each UIL team&rsquo;s chance to win its region title, from each game&rsquo;s projection. Shown once a region&rsquo;s two area
            games or its regional game are set.
          </p>
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            {chances.regions.map((r) => (
              <ChanceList key={`${r.bracket}-${r.region}`} id={`rc-${slugify(r.bracket)}-${r.region}`} title={`${r.bracket} · Region ${r.region}`} chances={r.chances} identities={identities} />
            ))}
          </div>
        </section>
      )}

      {reigning.length > 0 && (
        <section aria-labelledby="reigning" className="mt-8">
          <h2 id="reigning" className="section-title">
            {latest} UIL state champions
          </h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {reigning.map((f) => {
              const slug = slugify(f.champion);
              return (
                <li key={f.division} className="border border-line bg-panel px-3 py-2">
                  <p className="font-num text-[13px] font-bold uppercase tracking-widest text-red">
                    {f.division ? `Division ${f.division}` : "Six-man"}
                  </p>
                  {current.has(slug) ? (
                    <Link href={`/programs/${slug}`} className="flex min-h-11 items-center gap-2 font-num text-[22px] font-bold uppercase text-navy hover:underline">
                      <Crest school={f.champion} identity={identities.get(slug) ?? EMPTY} size={32} decorative />
                      {f.champion}
                    </Link>
                  ) : (
                    <p className="flex min-h-11 items-center font-num text-[22px] font-bold uppercase text-navy">{f.champion}</p>
                  )}
                  <p className="text-[14px] text-muted">
                    {f.championScore == null ? "Over" : `${f.championScore}-${f.runnerUpScore} over`} {f.runnerUp}
                  </p>
                </li>
              );
            })}
          </ul>
          <Link href="/championships" className="link-more">
            Every state championship
          </Link>
        </section>
      )}
    </>
  );
}
