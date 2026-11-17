"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { dayLine, type Left, type LeftBox } from "@/lib/whos-left";

// "Who's left" (ADR 0094): the teams still in one bracket, most likely State Championship winner first, each with the game it
// plays next, its chance to win the State Championship where the site works one out (lib/advancement.ts), a button that lights
// its path in the drawing above, and its program page's playoff path. It is worked out from the same boxes as the drawing
// (lib/whos-left.ts), so the two cannot disagree. A projection, not a result (ADR 0004).

/** "Area · Fri, Nov 20 · 7:00 PM · vs Hermleigh": the next game as one line, "vs" the team or the game whose winner it will be. */
function nextLine(box: LeftBox, key: string): string {
  const other = box.sides.find((s) => s.key !== key) ?? box.sides[1];
  const when = box.state === "disputed" ? "result under review" : [box.date ? dayLine(box.date) : "date not listed yet", box.time].filter(Boolean).join(" · ");
  return [box.label, when, `vs ${other.bye ? "a bye" : other.text}`].join(" · ");
}

export function WhosLeft({ rows, team, onFollow, titled }: { rows: Left[]; team: string | null; onFollow: (key: string) => void; titled: boolean }) {
  if (!rows.length) return null;
  const champion = rows.length === 1 && rows[0].state === "champion";
  return (
    <section id="whos-left" data-whos-left aria-labelledby="whos-left-title" className="mt-6 scroll-mt-4 print:hidden">
      <h2 id="whos-left-title" className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
        {champion ? "State champion" : "Who’s left"}{" "}
        <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">· {rows.length} {rows.length === 1 ? "team" : "teams"}</span>
      </h2>
      <p className="px-3 pt-1 text-[13px] leading-5 text-muted">
        {champion ? "" : `Teams still in this bracket${titled ? ", highest State title chance first" : ""}, each with its next game. `}
        {titled && !champion ? "A chance is a projection from the current ratings, not a result." : ""}
      </p>
      <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {rows.map((l) => (
          <li key={l.key} data-left={l.key} className="min-w-0 border-b border-line px-3 py-1">
            <div className="row-between">
              {l.program ? (
                <Link href={`/programs/${l.program}#path`} prefetch={false} className="flex min-h-11 min-w-0 flex-1 items-center text-[18px] font-bold leading-tight text-ink hover:text-navy hover:underline">
                  <span className="line-clamp-2">{l.name}</span>
                  <span className="sr-only">, playoff path</span>
                </Link>
              ) : (
                <span className="flex min-h-11 min-w-0 flex-1 items-center text-[18px] font-bold leading-tight text-ink">
                  <span className="line-clamp-2">{l.name}</span>
                </span>
              )}
              {titled && l.title && l.state !== "champion" && (
                <span className="shrink-0 text-right leading-none">
                  <span className="block font-num text-[22px] font-bold tabular-nums text-navy">{l.title}</span>
                  <span className="block text-[12px] uppercase tracking-wider text-muted">State title chance</span>
                </span>
              )}
            </div>
            <p className="text-[14px] leading-5 text-ink">
              {l.state === "champion" ? "Won the State Championship" : l.next ? `Next: ${nextLine(l.next, l.key)}` : "Next game not set yet"}
            </p>
            <div className="flex flex-wrap items-center gap-x-4">
              <button
                type="button"
                aria-pressed={team === l.key}
                onClick={() => onFollow(l.key)}
                className="inline-flex min-h-11 items-center text-[14px] font-semibold text-navy underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-navy"
              >
                {team === l.key ? "Path lit above" : "Light its path"}
                <span className="sr-only"> for {l.name}</span>
              </button>
              {l.next?.href && (
                <Link href={l.next.href} className="inline-flex min-h-11 items-center text-[14px] font-semibold text-navy hover:underline">
                  Next game page
                  <ChevronRight aria-hidden="true" className="size-4" />
                  <span className="sr-only"> for {l.name}</span>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
