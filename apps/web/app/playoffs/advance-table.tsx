import Link from "next/link";
import type { Advancement } from "@/lib/advancement";
import { roundLabel } from "@/lib/brackets";
import { EMPTY, type loadIdentities } from "@/lib/identity";
import { chanceText, chanceTexts } from "@/lib/projection";
import { slugify } from "@/lib/slug";
import { CrestSlot } from "../ui";

/** A chance to reach a round: "In" once the team is there, "—" when a team it could meet has too few games to project. */
const reachText = (p: number | undefined) => (p === undefined ? "—" : p === 1 ? "In" : chanceText(p));

/**
 * "Chance to reach each round" (ADR 0071): every team still in, its chance to reach each round still to be set and to
 * win the State Championship, most likely champion first. The table scrolls sideways inside itself on a phone, the
 * team column held in place; the page never does.
 */
export function AdvanceTable({ advancement: a, league, identities }: { advancement: Advancement; league: string; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  const titles = a.rows.every((r) => r.title !== undefined) ? chanceTexts(a.rows.map((r) => r.title!)) : a.rows.map((r) => reachText(r.title));
  const partial = a.rows.some((r) => [...r.reach, r.title].some((x) => x === undefined) && [...r.reach, r.title].some((x) => x !== undefined));
  const cell = "px-2 py-1 text-right font-num text-[17px] font-bold tabular-nums";
  return (
    <section data-advance-table aria-labelledby="advance" className="mt-5">
      <h2 id="advance" className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
        Chance to reach each round
      </h2>
      <div role="region" aria-label="Chance to reach each round, by team" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-navy">
        <table className="w-full min-w-[22rem] border-collapse text-[15px] text-ink">
          <thead>
            <tr className="border-b border-line text-[13px] uppercase tracking-wide text-muted">
              <th scope="col" className="sticky left-0 bg-page px-3 py-1 text-left font-semibold">Team</th>
              {a.rounds.map((r) => (
                <th key={r} scope="col" className="px-2 py-1 text-right font-semibold">{roundLabel(r, league)}</th>
              ))}
              <th scope="col" className="px-2 py-1 text-right font-semibold">Win the State Championship</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r, i) => {
              const slug = slugify(r.team);
              const none = [...r.reach, r.title].every((x) => x === undefined);
              return (
                <tr key={r.team} className="border-b border-line">
                  <th scope="row" className="sticky left-0 max-w-[11rem] bg-page px-1 text-left font-normal">
                    <Link href={`/programs/${slug}`} className="flex min-h-11 items-center text-ink hover:text-navy hover:underline">
                      <CrestSlot school={r.team} identity={identities.get(slug) ?? EMPTY} />
                      <span className="line-clamp-2 min-w-0 leading-tight">{r.team}</span>
                    </Link>
                  </th>
                  {none ? (
                    <td colSpan={a.rounds.length + 1} className="px-2 py-1 text-right text-[14px] text-muted">Not enough games to project</td>
                  ) : (
                    <>
                      {r.reach.map((p, j) => (
                        <td key={a.rounds[j]} className={`${cell} ${p === 1 ? "text-ink" : "text-navy"}`}>{reachText(p)}</td>
                      ))}
                      <td className={`${cell} text-navy`}>{titles[i]}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 pt-2 text-[13px] leading-5 text-muted">
        Worked out game by game up the bracket from the current ratings: the same chance to win each game page shows, on a neutral field for a pairing no site lists yet and in the State Championship. A final stands as played. &ldquo;In&rdquo;: already there.
        {partial && " —: not enough games to project, because a team it could meet has too few rated games."} A projection, not a result.
      </p>
    </section>
  );
}
