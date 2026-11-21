"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { LiveView } from "@/lib/live-scores";
import { dayLine } from "@/lib/whos-left";
import type { Box, TreeData } from "./data";
import { sideTag } from "./lines";
import { footClass, footer, SideRow } from "./parts";

// One round at a time (ADR 0094): the rounds as tabs (the ARIA tab pattern: one tablist, one tab per round, one panel for
// the round chosen; the arrow keys, Home and End move between tabs) and the round's games as cards: both teams, the score
// or the projection, the day, kickoff and site, and a link to the game's page. The panel the page opens on is the round
// being played, worked out when the page is built, so the first paint is already on it and nothing moves after load. A
// round that is not open stays in the page, hidden, so a search engine and the list below still have every game.

/** One game: away team first as the bracket has it; the teams are buttons that light a path (the board's), the card's
 * last line a link to the game page. `live` is the score under way, unconfirmed (ADR 0021). */
function RoundCard({ box, live, team, dim, onTeam }: { box: Box; live: LiveView | null; team: string | null; dim: boolean; onTeam: (key: string) => void }) {
  const scoreOf = (side: Box["sides"][number]) => (live ? (live.home.name === side.text ? live.home.score : live.away.name === side.text ? live.away.score : undefined) : undefined);
  const mine = team !== null && box.sides.some((s) => s.key === team);
  const lines = footer(box, live, Infinity);
  const played = box.state === "final" || box.state === "disputed" || box.state === "bye";
  const matchup = box.sides.map((s) => s.text).join(" vs ");
  return (
    <div
      data-box={box.id}
      data-card
      data-state={live ? "live" : box.state}
      className={`border bg-page transition-opacity ${box.state === "open" ? "border-dashed" : ""} ${mine ? "border-navy shadow-[0_0_0_1px_var(--color-navy)]" : "border-line"} ${dim ? "opacity-40" : ""}`}
    >
      <p className="rd-head">
        <span className="font-bold">{box.code ?? box.label}</span>
        <span>{[box.date ? dayLine(box.date) : played ? "" : "Date not listed yet", box.time].filter(Boolean).join(" · ")}</span>
      </p>
      <SideRow side={box.sides[0]} other={box.sides[1]} live={scoreOf(box.sides[0])} lit={team === box.sides[0].key} onTeam={onTeam} tag={sideTag(box, box.sides[0])} />
      <SideRow side={box.sides[1]} other={box.sides[0]} live={scoreOf(box.sides[1])} lit={team === box.sides[1].key} onTeam={onTeam} tag={sideTag(box, box.sides[1])} />
      <div className="border-t border-line px-2 py-1 text-[14px] leading-5">
        <p className={footClass(box, live)}>{lines[0]}</p>
        {live && lines[1] && <p className="text-muted">{lines[1]}</p>}
        {!played && <p className="text-muted">{box.site ? `Site: ${box.site}` : "Site not listed yet"}</p>}
      </div>
      {box.href && (
        // The name holds the words shown, then the game (ADR 0081); a hidden span would count as text cut short in the box.
        <Link href={box.href} prefetch={false} aria-label={`Game page for ${matchup}`} className="flex min-h-11 items-center justify-between border-t border-line px-2 text-[14px] font-semibold text-navy hover:bg-panel">
          <span>Game page</span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>
      )}
    </div>
  );
}

const tabClass = (on: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 font-num text-[16px] font-bold uppercase tracking-wide focus-visible:outline-2 focus-visible:-outline-offset-4 ${on ? "bg-band text-white focus-visible:outline-white" : "text-navy hover:bg-panel focus-visible:outline-navy"}`;

/** `current`: the tab open; `now`: the round being played (marked on its tab, whichever tab is open). */
export function RoundTabs({ data, current, now, onSelect, team, onPath, onTeam, liveOf }: {
  data: TreeData; current: number; now: number; onSelect: (i: number) => void; team: string | null; onPath: (id: string) => boolean;
  onTeam: (key: string) => void; liveOf: (b: Box) => LiveView | null;
}) {
  const uid = useId();
  const bar = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const n = data.rounds.length;

  // Keep the open tab in view in a bar that scrolls (five or six round names on a narrow phone), without moving the page.
  useEffect(() => {
    const el = bar.current;
    const tab = tabs.current[current];
    if (!el || !tab) return;
    const [from, to] = [tab.offsetLeft - el.offsetLeft, tab.offsetLeft - el.offsetLeft + tab.offsetWidth];
    if (from < el.scrollLeft) el.scrollLeft = from - 16;
    else if (to > el.scrollLeft + el.clientWidth) el.scrollLeft = to - el.clientWidth + 16;
  }, [current]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    onSelect(to);
    tabs.current[to]?.focus();
  };
  const id = (kind: "tab" | "panel", i: number) => `${uid}-${kind}-${i}`;

  return (
    <div data-rounds className="mt-2 print:hidden">
      <div ref={bar} role="tablist" aria-label={`${data.name} rounds`} className="sticky top-0 z-20 -mx-4 flex overflow-x-auto border-b-2 border-navy bg-page px-4">
        {data.rounds.map((r, i) => (
          <button
            key={r.round}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={id("tab", i)}
            aria-selected={i === current}
            aria-controls={id("panel", i)}
            tabIndex={i === current ? 0 : -1}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={tabClass(i === current)}
          >
            {i === now && <span aria-hidden="true" data-now className="size-2 shrink-0 bg-alert" />}
            {r.label}
            {i === now && <span className="sr-only"> (current round)</span>}
          </button>
        ))}
      </div>
      {data.rounds.map((r, i) => (
        <div key={r.round} role="tabpanel" id={id("panel", i)} aria-labelledby={id("tab", i)} hidden={i !== current} data-round={r.round} className="py-3">
          <h3 className="mb-2 font-num text-[18px] font-bold uppercase tracking-wide text-navy">
            {r.label}{" "}
            <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">
              · {r.ids.length} {r.ids.length === 1 ? "game" : "games"}
              {i === now ? " · current round" : ""}
            </span>
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.ids.map((gid) => (
              <li key={gid}>
                <RoundCard box={byId.get(gid)!} live={liveOf(byId.get(gid)!)} team={team} dim={!onPath(gid)} onTeam={onTeam} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
