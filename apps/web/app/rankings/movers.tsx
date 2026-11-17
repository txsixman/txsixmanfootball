import Link from "next/link";
import { biggestMovers, type Move } from "@/lib/rank-history";
import { rankedOrder } from "@/lib/rank-range";
import { movement, signed } from "@/lib/ratings";
import type { Row } from "./table";

function MoverList({ id, label, icon, moves, rows }: { id: string; label: string; icon: string; moves: Move[]; rows: Map<string, Row> }) {
  return (
    <div>
      <h3 id={id} className="font-num text-[15px] font-bold uppercase tracking-wide text-muted">{label}</h3>
      <ul aria-labelledby={id}>
        {moves.map((m) => {
          const row = rows.get(m.team)!;
          const words = `${m.places > 0 ? "Up" : "Down"} ${Math.abs(m.places)}`;
          const inner = (
            <>
              <span className={`w-20 shrink-0 font-num text-[17px] font-bold ${m.places > 0 ? "text-navy" : "text-red"}`}>
                <span aria-hidden="true">{icon} </span>
                {words}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[15px] font-semibold text-ink">{row.name}</span>
                <span className="block text-[13px] text-muted">
                  #{m.place}, from #{m.before} · rating {signed(m.change)}
                </span>
              </span>
            </>
          );
          return (
            <li key={m.team} className="border-b border-line">
              {row.href ? (
                <Link href={row.href} prefetch={false} className="flex min-h-12 items-center gap-2 py-1 hover:bg-panel">
                  {inner}
                </Link>
              ) : (
                <span className="flex min-h-12 items-center gap-2 py-1">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The teams that moved most places since a week earlier, up and down (ADR 0091), from the same moves the table's marks show
 * (lib/ratings.ts `movement`, which counts places among the rows of this page only). Nothing renders when no ranked team moved
 * or the table has no week-earlier ratings (a past season, or week 1).
 */
export function Movers({ rows, title }: { rows: Row[]; title: string }) {
  const ranked = rankedOrder([...rows]);
  const { risers, fallers } = biggestMovers(ranked, movement(ranked));
  if (!risers.length && !fallers.length) return null;
  const byTeam = new Map(rows.map((r) => [r.team, r]));
  return (
    <section aria-labelledby="movers" className="mt-4 border border-line px-3 pb-1 pt-2">
      <h2 id="movers" className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">{title}</h2>
      <p className="text-[13px] leading-5 text-muted">Places gained or lost since a week earlier. A team moves only when its rating moved by more than four points.</p>
      <div className="mt-1 grid gap-x-6 gap-y-2 md:grid-cols-2">
        {risers.length > 0 && <MoverList id="movers-up" label="Moving up" icon="▲" moves={risers} rows={byTeam} />}
        {fallers.length > 0 && <MoverList id="movers-down" label="Moving down" icon="▼" moves={fallers} rows={byTeam} />}
      </div>
    </section>
  );
}
