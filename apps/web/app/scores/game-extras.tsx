import Link from "next/link";
import type { ReactNode } from "react";
import { mediumDate, type Entry, type GameDetail } from "@/lib/game-pages";
import type { SeasonResult } from "@/lib/games";
import { projectionParts } from "@/lib/projection";
import { signed } from "@/lib/signed";
import { MIN_SURPRISE, surpriseOf } from "@/lib/why-moved";
import { FIRST_SEASON } from "@/lib/season";

// What a game page adds to the score for a robot-read game, on its own page and on a current-season playoff game's page.
// Words are rating, projected margin and win probability (never spreads, lines or odds), and nothing here names a
// winner of the game itself: robot-read scores are unconfirmed (ADR 0004).

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-5 px-3">
      <h2 id={id} className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** How far the finish was from the projection, from the favorite's side and clipped at the 45-point rule like "Why the rating moved". */
function distance(result: SeasonResult, favorite: string, margin: number): string {
  const [us, them] = favorite === result.home ? [result.homeScore, result.awayScore] : [result.awayScore, result.homeScore];
  const off = surpriseOf(us, them, margin);
  if (Math.abs(off) < MIN_SURPRISE) return `${favorite} finished about as projected.`;
  return `${favorite} finished ${Math.round(Math.abs(off))} points ${off > 0 ? "better" : "worse"} than the projected margin.`;
}

/** The week-before projection and how far the result was from it. Needs a game that was played. */
export function ProjectionSection({ result, detail }: { result: SeasonResult; detail: GameDetail }) {
  const p = detail.projection;
  if (!p) return null;
  const { margin, chance } = projectionParts(p);
  return (
    <Section id="projection" title="Projection before the game">
      <p className="pt-2 text-[18px] font-semibold leading-6 text-ink">
        {margin} <span className="text-muted">·</span> {chance}
      </p>
      {!result.forfeit && <p className="pt-1 text-[15px] leading-5 text-ink">{distance(result, p.favorite, p.margin)}</p>}
      <p className="pt-1 text-[13px] leading-4 text-muted">
        From both teams&rsquo; ratings at the end of the week before, once each had played four games. A projection, not a result.
      </p>
    </Section>
  );
}

/** Each team's record, and its rating when there is a projection, at the start of the game. */
export function GoingInSection({ away, home, detail }: { away: string; home: string; detail: GameDetail }) {
  const rows = [
    { team: away, ...detail.going.away },
    { team: home, ...detail.going.home },
  ];
  const rated = rows.every((r) => r.rating != null);
  if (!rows.some((r) => r.record)) return null;
  return (
    <Section id="going-in" title="Going in">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Each team&rsquo;s record{rated ? " and rating" : ""} before the game</caption>
        <thead>
          <tr className="text-[13px] uppercase tracking-wide text-muted">
            <th scope="col" className="py-1 font-semibold">Team</th>
            <th scope="col" className="py-1 text-right font-semibold">Record</th>
            {rated && <th scope="col" className="py-1 text-right font-semibold">Rating</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team} className="border-b border-line">
              <th scope="row" className="py-2 pr-2 text-[15px] font-semibold text-ink">{r.team}</th>
              <td className="py-2 text-right font-num text-[18px] font-bold tabular-nums text-ink">{r.record || <>&ndash;<span className="sr-only">no earlier games</span></>}</td>
              {rated && <td className="py-2 text-right font-num text-[18px] font-bold tabular-nums text-ink">{signed(r.rating!)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-1 text-[13px] text-muted">Records from season scores, not confirmed here.</p>
    </Section>
  );
}

/** The list under "Earlier meetings" and the preview's head-to-head: each game on its own page, away team first. */
export function MeetingsList({ detail }: { detail: GameDetail }) {
  const { total, list } = detail.meetings;
  return (
    <>
      <ul>
        {list.map(({ result: m }: Entry) => (
          <li key={m.id} className="border-b border-line">
            <Link href={m.href} className="grid min-h-14 grid-cols-[6.75rem_1fr_auto] items-center gap-x-3 py-1 hover:bg-panel">
              <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{mediumDate(m.date)}</span>
              <span className="min-w-0 text-[15px] leading-5 text-ink">
                {m.away} at {m.home}
              </span>
              <span className="font-num text-[19px] font-bold tabular-nums text-ink">{m.forfeit ? "Forfeit" : `${m.awayScore}-${m.homeScore}`}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="pt-1 text-[13px] text-muted">
        {total > list.length ? `The latest ${list.length} of ${total} games. ` : ""}Away team first. Scores are not confirmed here and may change.
      </p>
    </>
  );
}

/** Earlier games of the two programs, FIRST_SEASON on, each on its own page. Away team first, like every results list. */
export function MeetingsSection({ detail }: { detail: GameDetail }) {
  return (
    <Section id="meetings" title="Earlier meetings">
      {detail.meetings.total === 0 ? (
        <p className="py-2 text-[15px] text-muted">No earlier game between these two on record since {FIRST_SEASON}.</p>
      ) : (
        <MeetingsList detail={detail} />
      )}
    </Section>
  );
}
