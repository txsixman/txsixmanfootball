import Link from "next/link";
import type { Identity } from "@/lib/identity";
import { byRating, placeRows, rangeText, rankedOrder } from "@/lib/rank-range";
import { FEW_GAMES, movement, MOVE_THRESHOLD, record, signed, type RatingRow } from "@/lib/ratings";
import { meetingScore, type Meeting, type TeamSchedule } from "@/lib/schedule-strength";
import { CrestSlot, PageHeader } from "../ui";

/** `played`: the season's games the team has played, from the games the site lists (lib/season-results.ts playedCounts); the
 * rated count beside it is the ratings table's own `rated`. Absent on the invented sample, which then shows neither. */
export type Row = RatingRow & { name: string; href?: string; identity: Identity; schedule?: TeamSchedule; played?: number };

export function RankingsHeader({ eyebrow, note }: { eyebrow: string; note?: string }) {
  return <PageHeader id="rankings" eyebrow={eyebrow} title="Rankings" note={note} />;
}

function Moved({ by }: { by: number | "new" | undefined }) {
  if (by === undefined || by === 0) return null;
  if (by === "new") return <span className="block text-[13px] font-bold uppercase text-muted">New</span>;
  const up = by > 0;
  return (
    <span className={`block text-[13px] font-bold ${up ? "text-navy" : "text-red"}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}{Math.abs(by)}</span>
      <span className="sr-only">{up ? "up" : "down"} {Math.abs(by)} since last week</span>
    </span>
  );
}

/** A best win or worst loss: the opponent (a link when it is a program here) and the score, or the word for a forfeit. */
function MeetingCell({ meeting, hrefs }: { meeting?: Meeting; hrefs?: Map<string, string> }) {
  if (!meeting) return <span className="text-muted">None</span>;
  const href = hrefs?.get(meeting.opponent);
  return (
    <>
      {href ? (
        <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center text-ink hover:text-navy hover:underline">
          {meeting.opponent}
        </Link>
      ) : (
        meeting.opponent
      )}{" "}
      <Link href={meeting.href} prefetch={false} aria-label={`${meetingScore(meeting)}, game page`} className="inline-flex min-h-11 items-center whitespace-nowrap font-num text-[15px] tabular-nums text-muted hover:text-navy hover:underline">
        {meetingScore(meeting)}
      </Link>
    </>
  );
}

const WIDE = "hidden lg:table-cell"; // columns that do not fit a phone

/**
 * One list of teams, best first: ranks, rank ranges and tiers count these rows only (lib/rank-range.ts), so a page passes
 * the teams of one organization (or one UIL division). Teams with too few games are listed last as "NR". `hrefs` maps
 * an opponent's name to its program page, for the best win and worst loss columns, which show on wide screens only.
 */
export function RatingsTable({ rows, hrefs }: { rows: Row[]; hrefs?: Map<string, string> }) {
  const placed = placeRows(rows);
  const ranked = rankedOrder([...rows]);
  const ordered = [...ranked, ...rows.filter((r) => r.rated < FEW_GAMES).sort(byRating)];
  const moved = movement(ranked);
  const wide = rows.some((r) => r.schedule);
  return (
    <table className="mt-4 w-full border-collapse text-[15px]">
      <caption className="sr-only">Teams ranked by rating, best first. Teams in one tier have ratings that overlap. Teams with few games are not ranked. Under each team name: games played and games rated.</caption>
      <thead>
        <tr className="border-b-2 border-navy font-num text-[13px] uppercase tracking-wider text-muted">
          <th scope="col" className="w-8 py-1.5 pr-1.5 text-right font-semibold">#</th>
          <th scope="col" className="py-1.5 text-left font-semibold">Team</th>
          <th scope="col" className="w-12 py-1.5 text-right font-semibold">W-L</th>
          <th scope="col" className="w-[4.25rem] py-1.5 pr-1 text-right font-semibold">Rating</th>
          {wide && (
            <>
              <th scope="col" className={`${WIDE} w-24 py-1.5 pl-3 text-right font-semibold`}>Record strength</th>
              <th scope="col" className={`${WIDE} w-24 py-1.5 text-right font-semibold`}>Opp. rating</th>
              <th scope="col" className={`${WIDE} py-1.5 pl-4 text-left font-semibold`}>Best win</th>
              <th scope="col" className={`${WIDE} py-1.5 pl-4 text-left font-semibold`}>Worst loss</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {ordered.map((r, i) => {
          const place = placed.get(r.team)!;
          const few = r.rated < FEW_GAMES;
          const startsTier = place.tier != null && place.tier !== placed.get(ordered[i - 1]?.team)?.tier;
          const startsNR = few && (i === 0 || ordered[i - 1].rated >= FEW_GAMES);
          const name = (
            <>
              <CrestSlot school={r.name} identity={r.identity} />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-3 min-w-0 text-[14.5px] leading-[1.15]">{r.name}</span>
                {place.range && (
                  <span className="text-[13px] leading-4 text-muted">
                    <span className="sr-only">Rank range </span>
                    {rangeText(place.range)}
                  </span>
                )}
                {r.played != null && <span className="text-[13px] leading-4 text-muted">{r.played} played, {r.rated} rated</span>}
              </span>
            </>
          );
          const sched = r.schedule;
          return (
            <tr key={r.team} className={`border-b border-line ${(startsTier && i > 0) || startsNR ? "border-t-2 border-t-navy/40" : ""}`}>
              <td className="pr-1.5 text-right align-middle font-num text-[17px] font-semibold leading-tight text-muted">
                {place.rank ?? (
                  <>
                    <span aria-hidden="true" className="text-[14px]">NR</span>
                    <span className="sr-only">Not ranked</span>
                  </>
                )}
                {!few && <Moved by={moved?.get(r.team)} />}
              </td>
              <th scope="row" className="text-left font-normal">
                {(startsTier || startsNR) && (
                  <span className={`block pt-1 text-[12px] font-bold uppercase tracking-wider ${startsNR ? "text-muted" : "text-navy"}`}>
                    {startsNR ? `Not ranked: fewer than ${FEW_GAMES} games` : `Tier ${place.tier}`}
                  </span>
                )}
                {r.href ? (
                  <Link href={r.href} prefetch={false} className="flex min-h-12 items-center text-ink hover:text-navy hover:underline">
                    {name}
                  </Link>
                ) : (
                  <span className="flex min-h-12 items-center text-ink">{name}</span>
                )}
              </th>
              <td className="text-right font-num text-[17px] tabular-nums">{record(r)}</td>
              <td className="pr-1 text-right font-num tabular-nums">
                {few ? (
                  <>
                    <span className="block text-[20px] font-bold text-muted">{signed(r.rating)}</span>
                    <span className="block text-[13px] font-semibold uppercase tracking-wide text-muted">
                      {r.rated} {r.rated === 1 ? "game" : "games"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-[20px] font-bold leading-6 text-navy">{signed(r.rating)}</span>
                    {r.sd != null && (
                      <span className="block text-[13px] leading-4 text-muted">
                        <span aria-hidden="true">±{Math.round(r.sd)}</span>
                        <span className="sr-only">give or take {Math.round(r.sd)}</span>
                      </span>
                    )}
                  </>
                )}
              </td>
              {wide && (
                <>
                  <td className={`${WIDE} pl-3 text-right font-num text-[17px] tabular-nums`}>{sched ? signed(sched.sor) : ""}</td>
                  <td className={`${WIDE} text-right font-num text-[17px] tabular-nums`}>{sched ? signed(sched.sos) : ""}</td>
                  <td className={`${WIDE} pl-4 text-[14.5px] leading-tight`}>{sched && <MeetingCell meeting={sched.best} hrefs={hrefs} />}</td>
                  <td className={`${WIDE} pl-4 text-[14.5px] leading-tight`}>{sched && <MeetingCell meeting={sched.worst} hrefs={hrefs} />}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HowToRead({ schedule = false, basis = false }: { schedule?: boolean; basis?: boolean }) {
  return (
    <section aria-labelledby="how" className="mt-8 border border-line bg-panel px-4 py-3 text-[15px] text-ink">
      <h2 id="how" className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">How to read this</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>Teams are ranked by rating. A rating is points better or worse than the average team in the table, on a neutral field. Ranks count the teams of one organization only, and start at 1 in each.</li>
        <li>The small ± figure is how far the rating could be off: teams within it of each other cannot be told apart. The rank range ("#3 to #13") is the places a team would hold if its rating were that much higher or lower. Teams whose ranges overlap are grouped in a tier.</li>
        <li>The projected margin between two teams is the difference in their ratings.</li>
        <li>A game ended by the 45-point rule counts as a win by at least 45, not by the score on the board.</li>
        <li>Forfeits count in the record but not the rating.</li>
        {basis && (
          <li>
            Under each team: games played this season, and how many of them are rated. A rating rests on the rated games only; a forfeit is played but not rated.
            <Link href="/about/ratings" className="flex min-h-11 w-fit items-center font-semibold text-navy underline">What a rating rests on</Link>
          </li>
        )}
        <li>An arrow beside a rank shows places moved since a week earlier, within the organization (or division) tab you are on. It shows only when the rating itself moved by more than {MOVE_THRESHOLD} points.</li>
        <li>A team with fewer than {FEW_GAMES} rated games is not ranked (NR), is listed last, and shows its game count: one result can move its rating a long way.</li>
        {schedule && <li>On wide screens: record strength is a team&rsquo;s wins minus the wins a typical top-25 team would be expected to get against the same opponents at the same sites; the opponents&rsquo; rating is the average rating of the teams it played. Both, with the best win and worst loss, are also on every program page.</li>}
      </ul>
      <Link href="/rankings/how" className="mt-2 inline-flex min-h-11 items-center font-semibold text-navy underline">
        How the rankings work
      </Link>
    </section>
  );
}
