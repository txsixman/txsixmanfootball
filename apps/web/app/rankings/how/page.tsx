import type { Metadata } from "next";
import Link from "next/link";
import { loadBacktest, type Backtest } from "@/lib/backtest";
import { BENCHMARK_TEAMS } from "@/lib/schedule-strength";
import { FEW_GAMES, MOVE_THRESHOLD } from "@/lib/ratings";
import { loadTrackRecord } from "@/lib/track-record";
import { PageHeader } from "../../ui";
import { ScorecardChart } from "./scorecard-chart";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "How the rankings work | Project 80x40" };

// Plain-language method note for /rankings (backlog item 8). It must stay true to services/ratings/model.py; the words
// are rating, projected margin and win probability, never betting terms. No source is named (ADR 0010).
const STEPS: { title: string; body: string }[] = [
  {
    title: "It starts from the scores",
    body: "Each team gets one number. For every game, the difference between the two teams' numbers, plus a home-field edge, should come close to the final margin. The ratings are the numbers that fit all of the season's games best at once.",
  },
  {
    title: "The 45-point rule is a floor, not a score",
    body: "A six-man game stops when a team leads by 45 or more. That final score says the margin was at least 45, not exactly what the board showed, so the rating counts it as a win by at least 45. A team gains nothing from a bigger score on the board, and loses nothing when the game stops early.",
  },
  {
    title: "Teams start from last season and their league",
    body: "Before a team has played, its rating starts from where it finished last season, measured against its league's average. A team with no rating last season starts at its league's average. Each result moves a team away from there, so a team with one or two games stays close to its start until more results come in. Each league's average is worked out from the games that leagues play against each other.",
  },
  {
    title: "Forfeits do not count",
    body: "A forfeit counts in the win-loss record, but no game was played, so it says nothing about strength and is left out of the rating. So is a 0-0 game and a game listed twice.",
  },
  {
    title: "Opponents matter",
    body: "Beating a strong team by 20 lifts a rating more than beating a weak one by 20, because every game is weighed against both teams' ratings at the same time. Teams from different leagues are linked through the games they played against each other, and through games against schools we do not list.",
  },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const bandLabel = (from: number, to: number) => (from >= 0.99 ? "Over 99%" : `${Math.round(from * 100)} to ${Math.round(to * 100)}%`);

type Split = Backtest["scorecard"]["season"][number];
const GROUPS = [
  { key: "season", title: "By season" },
  { key: "phase", title: "Regular season and playoffs" },
  { key: "league", title: "By organization" },
] as const;

/** The scorecard: for each split of the games, how many, the favorite's chance the ratings gave on average, and how often
 * the favorite won; then each split by band of that chance (the band names the chance said, the cell says what happened). */
function Scorecard({ scorecard }: { scorecard: Backtest["scorecard"] }) {
  const edges = scorecard.bands;
  const total = scorecard.phase.reduce((n, r) => n + r.games, 0);
  const said = scorecard.phase.reduce((n, r) => n + r.said * r.games, 0) / total;
  const happened = scorecard.phase.reduce((n, r) => n + r.happened * r.games, 0) / total;
  const series = scorecard.phase.map((r) => ({ label: r.label, points: r.bands.map((b) => ({ said: b.said, happened: b.happened, games: b.games })) }));
  return (
    <section aria-labelledby="scorecard" className="mt-8">
      <h2 id="scorecard" className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">Said versus happened</h2>
      <p className="mt-1 text-[15px] text-ink">
        Every week of 2022 to 2026 was predicted from only the games before it. Across {total.toLocaleString("en-US")} games the ratings gave the
        favorite {pct(said)} on average, and the favorite won {pct(happened)}. If the ratings are honest those two numbers match, in every season, in the
        playoffs as in the regular season, and in every organization:
      </p>
      <ScorecardChart series={series} />
      <div className="mt-3 overflow-x-auto" role="region" aria-label="Said versus happened, by group of games" tabIndex={0}>
        <table className="w-full text-left text-[15px] text-ink">
          <caption className="sr-only">The favorite&rsquo;s chance the ratings gave, against how often the favorite won, by season, by regular season and playoffs, and by organization</caption>
          <thead>
            <tr className="border-b-2 border-navy text-[13px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-2 font-bold">Group</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Games</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Ratings said</th>
              <th scope="col" className="py-2 text-right font-bold">Favorite won</th>
            </tr>
          </thead>
          {GROUPS.map(({ key, title }) => (
            <tbody key={key}>
              <tr>
                <th scope="rowgroup" colSpan={4} className="pt-3 text-[13px] font-bold uppercase tracking-wide text-navy">{title}</th>
              </tr>
              {scorecard[key].map((r) => (
                <tr key={r.label} className="border-b border-line">
                  <th scope="row" className="py-2 pr-2 font-semibold">{r.label}</th>
                  <td className="py-2 pr-2 text-right font-num tabular-nums">{r.games.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-2 text-right font-num tabular-nums">{pct(r.said)}</td>
                  <td className="py-2 text-right font-num font-bold tabular-nums text-navy">{pct(r.happened)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {GROUPS.map(({ key, title }) => (
        <details key={key} className="mt-3 border-t border-line">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-navy">{title}, by band</summary>
          <div className="overflow-x-auto" role="region" aria-label={`${title}, by band of the favorite's chance`} tabIndex={0}>
            <table className="w-full text-left text-[14px] text-ink">
              <caption className="sr-only">Share of favorites that won, with the number of games, by band of the favorite&rsquo;s chance, {title.toLowerCase()}</caption>
              <thead>
                <tr className="border-b-2 border-navy text-[13px] uppercase tracking-wide text-muted">
                  <th scope="col" className="py-2 pr-2 font-bold">Chance said</th>
                  {scorecard[key].map((r: Split) => (
                    <th key={r.label} scope="col" className="py-2 pr-2 text-right font-bold">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {edges.slice(0, -1).map((from, i) => (
                  <tr key={from} className="border-b border-line">
                    <th scope="row" className="whitespace-nowrap py-2 pr-2 font-semibold">{bandLabel(from, edges[i + 1])}</th>
                    {scorecard[key].map((r: Split) => {
                      const b = r.bands.find((x) => x.from === from);
                      return (
                        <td key={r.label} className="py-2 pr-2 text-right font-num tabular-nums">
                          {b ? (
                            <>
                              <span className="font-bold text-navy">{pct(b.happened)}</span>
                              <span className="block text-[12px] text-muted">{b.games} {b.games === 1 ? "game" : "games"}</span>
                            </>
                          ) : (
                            "none"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      <p className="mt-2 text-[13px] text-muted">
        The chance for each game comes from ratings that never saw the season being predicted, and from a scale fit on the other seasons. Only games where
        both teams already had {FEW_GAMES} rated games count; ties and forfeits are left out. A game counts under both teams&rsquo; organizations, so
        those rows overlap. The playoffs are every bracket game. Scores are not confirmed here and may change.
      </p>
    </section>
  );
}

type Scores = { accuracy: number; mae: number };
type Methods = { model: Scores; elo: Scores; last_season?: Scores | null };
type Row = Methods & { label: string; games: number };

/** One backtest table: a row a season, then the total, with the ratings beside the two simpler methods. The ratings
 * are `model`, the ratings as the site's tables compute them (lib/backtest.ts). */
function BacktestTable({
  id, title, caption, rows, total, pick, show, best,
}: {
  id: string; title: string; caption: string; rows: Row[]; total: Methods & { games: number };
  pick: (m: Scores) => number; show: (n: number) => string; best: "max" | "min";
}) {
  const all: Row[] = [...rows, { ...total, label: "2022 to 2026" }];
  return (
    <>
      <h3 id={id} className="mt-5 font-num text-[18px] font-bold uppercase tracking-wide text-navy">{title}</h3>
      <div className="mt-1 overflow-x-auto" role="region" aria-labelledby={id} tabIndex={0}>
        <table className="w-full text-left text-[15px] text-ink">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-navy text-[13px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-2 font-bold">Season</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Games</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Ratings</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Elo</th>
              <th scope="col" className="py-2 text-right font-bold">Last season</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r, i) => {
              const values = [r.model, r.elo, r.last_season].map((m) => (m ? pick(m) : null));
              const known = values.filter((v) => v !== null);
              const top = best === "max" ? Math.max(...known) : Math.min(...known);
              return (
                <tr key={r.label} className={`border-b border-line ${i === all.length - 1 ? "border-t-2 border-t-navy" : ""}`}>
                  <th scope="row" className="py-2 pr-2 font-semibold">{r.label}</th>
                  <td className="py-2 pr-2 text-right font-num tabular-nums">{r.games.toLocaleString("en-US")}</td>
                  {values.map((v, j) => (
                    <td key={j} className={`py-2 text-right font-num tabular-nums ${j < 2 ? "pr-2" : ""} ${v === top ? "font-bold text-navy" : ""}`}>
                      {v === null ? "none" : show(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function HowPage() {
  const [track, backtest] = await Promise.all([loadTrackRecord(), loadBacktest()]);
  const rows: Row[] = backtest.seasons.map((s) => ({ ...s, label: String(s.season) }));
  return (
    <article aria-labelledby="how" className="max-w-prose">
      <Link href="/rankings" className="inline-flex min-h-11 items-center font-semibold text-navy underline">
        Back to rankings
      </Link>
      <PageHeader
        id="how"
        size="md"
        eyebrow="Rankings"
        title="How the rankings work"
      />
      <p className="mt-3 text-[16px] text-ink">
        Teams are ranked by their rating, best first, within one organization at a time (UIL, TAPPS, TAIAO or TCAF) and, for UIL, within Division I and Division II. A rating is how many points better or worse a team is than the average team in the table, on a neutral field. The projected margin between two teams is the difference in their ratings.
      </p>
      <ol className="mt-6 space-y-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="border-l-4 border-red pl-3">
            <h2 className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-1 text-[16px] text-ink">{s.body}</p>
          </li>
        ))}
      </ol>
      <section aria-labelledby="track" className="mt-8">
        <h2 id="track" className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">How well it picks games</h2>
        <p className="mt-1 text-[15px] text-ink">
          Before each game from {track.seasons.at(-1)} to {track.seasons[0]}, both teams&rsquo; ratings from the week before gave a
          favorite and a win probability. Across {track.games.toLocaleString("en-US")} games, the favorite won{" "}
          {pct(track.favoriteWon / track.games)} of the time. When the ratings say 70%, the favorite should win about 7 games in 10:
        </p>
        <table className="mt-3 w-full text-left text-[15px] text-ink">
          <caption className="sr-only">How often the favorite won, by its win probability before the game, next to the average win probability the ratings gave</caption>
          <thead>
            <tr className="border-b-2 border-navy text-[13px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-2 font-bold">Win probability</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Games</th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">Ratings said</th>
              <th scope="col" className="py-2 text-right font-bold">Favorite won</th>
            </tr>
          </thead>
          <tbody>
            {track.bands.map((b) => (
              <tr key={b.from} className="border-b border-line">
                <th scope="row" className="py-2 pr-2 font-semibold">{bandLabel(b.from, b.to)}</th>
                <td className="py-2 pr-2 text-right font-num tabular-nums">{b.games.toLocaleString("en-US")}</td>
                <td className="py-2 pr-2 text-right font-num tabular-nums">{pct(b.expected)}</td>
                <td className="py-2 text-right font-num font-bold tabular-nums text-navy">{pct(b.favoriteWon / b.games)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[13px] text-muted">
          Counted once both teams had played four games. Ties and forfeits are left out. Scores are not confirmed here and may change.
        </p>
      </section>

      <section aria-labelledby="backtest" className="mt-8">
        <h2 id="backtest" className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">How well the ratings predict</h2>
        <p className="mt-1 text-[15px] text-ink">
          To check the ratings fairly, each week of a season is rated only from the games before it, then used to pick that
          week&rsquo;s winners and projected margins. Nothing from the week being predicted, or after it, is used. The same games
          are scored for all three methods:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-ink">
          <li><b>Ratings</b>: the ratings on this site.</li>
          <li><b>Elo</b>: a simple win-loss rating (Elo) that moves up or down after every game, with big margins capped.</li>
          <li><b>Last season</b>: last season&rsquo;s final rating, plus home field, held fixed all year.</li>
        </ul>
        <BacktestTable
          id="backtest-picked"
          title="Winners picked"
          caption="Share of games where the team with the higher projected margin won, by season, for the ratings and two simpler methods"
          rows={rows}
          total={backtest.overall_from_2022}
          pick={(m) => m.accuracy}
          show={(n) => pct(n)}
          best="max"
        />
        <BacktestTable
          id="backtest-miss"
          title="Average margin miss, in points"
          caption="Average number of points between the projected margin and the final margin, by season, for the ratings and two simpler methods"
          rows={rows}
          total={backtest.overall_from_2022}
          pick={(m) => m.mae}
          show={(n) => n.toFixed(1)}
          best="min"
        />
        <p className="mt-2 text-[13px] text-muted">
          Only games where both teams already had {FEW_GAMES} rated games count. Ties and forfeits are left out, and a miss
          is counted as at most 45 points, since a game ends at a 45-point lead. The best figure in each row is in bold. 2021
          has no earlier season, so there is no last-season figure for it and the total leaves it out. 2026 counts games
          played so far. Scores are not confirmed here and may change.
        </p>
      </section>

      <Scorecard scorecard={backtest.scorecard} />

      <section aria-labelledby="ranges" className="mt-8">
        <h2 id="ranges" className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">Ranges, tiers and record strength</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] text-ink">
          <li>
            <b>Rating ±</b>: how far a rating could be off, from how few games and how lopsided they were. Two teams within it of each other cannot be told
            apart. The <b>rank range</b> is the places a team would hold if its rating were that much higher or lower and every other team stayed put.
            A <b>tier</b> is a group of teams whose rating ranges overlap the best team in it.
          </li>
          <li>
            An <b>arrow</b> shows only when a rating moved more than {MOVE_THRESHOLD} points in a week. A team with fewer than {FEW_GAMES} rated games is not
            ranked (NR) and is left out of everyone else&rsquo;s range.
          </li>
          <li>
            <b>Record strength</b>: a team&rsquo;s wins minus the wins a typical top-{BENCHMARK_TEAMS} team in its organization would be expected to get against
            the same opponents at the same sites, using the same win probabilities as above. A 9-0 team on a soft schedule sits near zero; a 4-6 team on a
            hard one can sit well above it.
          </li>
        </ul>
      </section>

      <section aria-labelledby="limits" className="mt-8 border border-line bg-panel px-4 py-3">
        <h2 id="limits" className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">What it cannot tell you</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] text-ink">
          <li>Injuries, weather, or who played. It sees only final scores.</li>
          <li>Much about a team with fewer than {FEW_GAMES} rated games. Those ratings are grayed in the rankings.</li>
          <li>Anything certain. Scores are not confirmed here and may change, and the ratings change with them after every game night.</li>
        </ul>
      </section>
    </article>
  );
}
