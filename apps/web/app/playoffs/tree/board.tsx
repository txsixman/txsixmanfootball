"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { geometry } from "@/lib/bracket-layout";
import { liveView, type LiveView } from "@/lib/live-scores";
import { useLiveScores } from "../../scores/live-score";
import { ShareButton } from "../../share-button";
import type { Box, BoxSide, TreeData } from "./data";
import { boxLines } from "./lines";

// The bracket drawn (ADR 0049). Two views of the same boxes: the whole tree (rounds as columns, both halves meeting at the
// final, connectors from each pair of games to the one they feed) and one round at a time (columns that snap, with the
// round names held at the top). Wide screens open on the tree, phones on the rounds; either can switch. Tapping a team
// lights its path, games played and the route ahead; tapping a game opens its page. A game under way shows its live
// score in place, unconfirmed (ADR 0021). Every box is real text and every control a button or link, so it reads with a
// keyboard and a screen reader; the round-by-round list below the drawing holds the same games.

type View = "auto" | "tree" | "rounds";

/** The two lines under the teams: a game under way says so, unconfirmed (ADR 0021). */
function footer(b: Box, live: LiveView | null, max: number): [string, string] {
  if (live) return live.finished ? ["Final · Unconfirmed", ""] : [["Live", live.period].filter(Boolean).join(" · "), "Unconfirmed"];
  return boxLines(b, max);
}

function SideRow({ side, other, live, lit, onTeam }: { side: BoxSide; other: BoxSide; live?: number; lit: boolean; onTeam: (key: string) => void }) {
  const right = live ?? side.score ?? side.chance;
  const lost = other.won && !side.won;
  const text = (
    <>
      <span className={`min-w-0 flex-1 break-words leading-[15px] ${side.won ? "font-bold text-ink" : lost ? "text-muted" : "text-ink"}`}>{side.text}</span>
      {right != null && (
        <span className={`shrink-0 font-num tabular-nums ${typeof right === "string" ? "text-[13px] font-semibold text-navy" : `text-[19px] font-bold ${live != null ? "text-red" : ""}`}`}>
          {right}
        </span>
      )}
    </>
  );
  if (!side.key) {
    return <span title={side.title ?? side.text} className={`relative flex h-11 items-center gap-1 px-1.5 text-[13px] ${side.bye ? "text-muted" : "italic text-muted"}`}>{text}</span>;
  }
  return (
    <button
      type="button"
      title={side.text}
      aria-pressed={lit}
      onClick={() => onTeam(side.key!)}
      className={`relative z-10 flex h-11 w-full items-center gap-1 px-1.5 text-left text-[13px] hover:bg-panel focus-visible:outline-2 focus-visible:outline-navy ${lit ? "bg-panel" : ""}`}
    >
      {text}
    </button>
  );
}

/** `max`: the characters of 13px semibold text that fit on a line of the box. */
function BoxView({ box, live, team, dim, onTeam, max, style }: { box: Box; live: LiveView | null; team: string | null; dim: boolean; onTeam: (key: string) => void; max: number; style?: CSSProperties }) {
  const scoreOf = (s: BoxSide) => (live ? (live.home.name === s.text ? live.home.score : live.away.name === s.text ? live.away.score : undefined) : undefined);
  const mine = team !== null && box.sides.some((s) => s.key === team);
  const title = [box.code, box.label, box.when, box.time, box.site].filter(Boolean).join(" · ");
  const lines = footer(box, live, max);
  return (
    <div
      data-box={box.id}
      data-state={live ? "live" : box.state}
      title={title}
      style={style}
      className={`relative border bg-page transition-opacity ${box.state === "open" ? "border-dashed" : ""} ${mine ? "border-navy shadow-[0_0_0_1px_var(--color-navy)]" : "border-line"} ${dim ? "opacity-40" : ""}`}
    >
      {box.href && (
        <Link href={box.href} className="absolute inset-0 hover:bg-panel/60" aria-label={`${box.code ? `${box.code}, ` : ""}${box.label}: ${box.sides.map((s) => s.text).join(" vs ")}. Game page`} />
      )}
      <p className="pointer-events-none relative flex h-[18px] items-center justify-between gap-1 whitespace-nowrap border-b border-line px-1.5 leading-none text-muted">
        <span className="text-[12px] font-bold uppercase tracking-wider">{box.code}</span>
        <span className="text-[12px] uppercase tracking-wider">{box.when}</span>
      </p>
      <SideRow side={box.sides[0]} other={box.sides[1]} live={scoreOf(box.sides[0])} lit={team === box.sides[0].key} onTeam={onTeam} />
      <SideRow side={box.sides[1]} other={box.sides[0]} live={scoreOf(box.sides[1])} lit={team === box.sides[1].key} onTeam={onTeam} />
      <p data-foot className="pointer-events-none relative flex h-[36px] flex-col justify-center border-t border-line px-1.5 text-[13px] leading-4">
        <span className={live ? "font-bold text-red" : box.projection ? "font-semibold text-navy" : "text-muted"}>{lines[0]}</span>
        {lines[1] && <span className="text-muted">{lines[1]}</span>}
      </p>
    </div>
  );
}

/** The games a team has played and the route ahead of it, while it is still in. */
function pathOf(boxes: Box[], team: string | null) {
  if (!team) return null;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const played = boxes.filter((b) => b.sides.some((s) => s.key === team));
  const path = new Set(played.map((b) => b.id));
  const tip = played.find((b) => !b.to || !path.has(b.to));
  const out = tip?.state === "final" && !tip.sides.find((s) => s.key === team)?.won; // it lost its last game
  const ahead = new Set<string>();
  for (let id = tip && !out ? tip.to : undefined; id; id = byId.get(id)?.to) ahead.add(id);
  return { path, ahead };
}

/** `imageBase`: where the downloadable images are, or null for a page that has none (the sample). `list`: the page has the
 * games as a list below (#games-by-round). */
export function BracketBoard({ data, imageBase, list = true }: { data: TreeData; imageBase: string | null; list?: boolean }) {
  const [view, setView] = useState<View>(data.whole ? "auto" : "rounds");
  const [team, setTeam] = useState<string | null>(null);
  const [fit, setFit] = useState(false);
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState(0);
  const [wide, setWide] = useState<boolean | null>(null); // null until the browser says, so the server's page matches
  const [copied, setCopied] = useState(false);
  const treeBox = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const geo = useMemo(() => geometry(data), [data]);
  const max = Math.floor((geo.boxW - 12) / 7); // the tree's boxes; the rounds' are wider
  const byId = useMemo(() => new Map(data.boxes.map((b) => [b.id, b])), [data]);
  const liveRows = useLiveScores(data.boxes.flatMap((b) => (b.live ? [b.live] : [])));
  const liveOf = (b: Box) => (b.live ? liveView(liveRows, b.live) : null);
  const lit = useMemo(() => pathOf(data.boxes, team), [data, team]);
  const onPath = (id: string) => !lit || lit.path.has(id) || lit.ahead.has(id);
  const onTeam = (key: string) => setTeam((t) => (t === key ? null : key));

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const set = () => setWide(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  const shown = view === "auto" ? (wide === null ? null : wide ? "tree" : "rounds") : view;

  // How far the tree must shrink to fit its frame, for "Fit to screen" and the phone's whole-bracket view.
  useEffect(() => {
    const el = treeBox.current;
    if (!el || !geo.width) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / geo.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [geo.width]);

  // The round in view in the rounds strip, for the bar held over it.
  const onStrip = () => {
    const el = strip.current;
    const col = el?.firstElementChild as HTMLElement | null;
    if (!el || !col) return;
    setCurrent(Math.min(data.rounds.length - 1, Math.round(el.scrollLeft / col.offsetWidth)));
  };
  const goRound = (i: number) => {
    const el = strip.current;
    const col = el?.children[i] as HTMLElement | undefined;
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: "smooth" });
    setCurrent(i);
  };

  const pick = (v: View) => {
    setView(v);
    if (v === "tree" && window.matchMedia("(max-width: 767px)").matches) setFit(true); // the phone's whole bracket opens fitted
  };
  const treeShown = view === "tree" ? "block" : view === "rounds" ? "hidden" : "hidden md:block";
  const roundsShown = view === "rounds" ? "block" : view === "tree" ? "hidden" : "md:hidden";
  const btn = (on: boolean) => `inline-flex min-h-11 items-center px-3 text-[14px] font-bold ${on ? "bg-navy text-white" : "text-navy hover:bg-panel"}`;
  const printZoom = geo.width ? Math.min(1, 995 / geo.width, 700 / geo.height) : 1;
  const teamName = team && data.boxes.flatMap((b) => b.sides).find((s) => s.key === team)?.text;

  return (
    <section aria-labelledby="bracket-drawing" data-tree-print className="mt-4" style={{ "--print-zoom": printZoom } as CSSProperties}>
      <h2 id="bracket-drawing" className="sr-only">
        {data.name} bracket drawing
      </h2>
      <p className="hidden font-num text-[18px] font-bold uppercase tracking-wide text-navy print:block">
        {data.name} · TX Six-Man Football · txsixmanfootball.com
      </p>
      <div data-print-hide className="flex flex-wrap items-center gap-2">
        {data.whole && (
          <div role="group" aria-label="Bracket view" className="inline-flex border-2 border-navy">
            <button type="button" aria-pressed={shown === "tree"} onClick={() => pick("tree")} className={`${btn(view === "tree")} ${view === "auto" ? "md:bg-navy md:text-white" : ""}`}>
              Whole bracket
            </button>
            <button type="button" aria-pressed={shown === "rounds"} onClick={() => pick("rounds")} className={`${btn(view === "rounds")} ${view === "auto" ? "max-md:bg-navy max-md:text-white" : ""}`}>
              By round
            </button>
          </div>
        )}
        {data.whole && scale < 1 && view !== "rounds" && (
          <button type="button" aria-pressed={fit} onClick={() => setFit((f) => !f)} className={`${btn(fit)} border-2 border-navy ${view === "auto" ? "max-md:hidden" : ""}`}>
            {fit ? "Full size" : "Fit to screen"}
          </button>
        )}
        {/* Saving and sharing behind one button, so a phone reaches the bracket after one row of controls. Opened, it
            takes a line of its own. */}
        <details className="group open:basis-full">
          <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">Save or share</summary>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {imageBase && (
              <a href={`${imageBase}/share.png`} download className="btn">
                Download image
              </a>
            )}
            {imageBase && data.whole && (
              <a href={`${imageBase}/full.png`} download className="btn">
                Full-size image
              </a>
            )}
            <button type="button" onClick={() => window.print()} className="btn max-md:hidden">
              Print
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => (setCopied(true), setTimeout(() => setCopied(false), 3000)), () => {})}
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <ShareButton title={`${data.name} bracket`} className="[&>p]:sr-only" />
          </div>
        </details>
      </div>
      <p data-print-hide className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted" aria-live="polite">
        {teamName ? (
          <>
            <span>{teamName}&rsquo;s path is lit.</span>
            <button type="button" onClick={() => setTeam(null)} className="inline-flex min-h-11 items-center font-semibold text-navy underline">
              Clear
            </button>
          </>
        ) : (
          <span>Tap a team to light its path. Tap a game for its page.</span>
        )}
        {/* The same games as a plain list, below the drawing: the way past it with a keyboard or a screen reader. */}
        {list && (
          <a href="#games-by-round" className="link-more">
            Games as a list
          </a>
        )}
      </p>

      {data.whole && (
        <div
          ref={treeBox}
          data-tree-scroll
          className={`${treeShown} mt-2 overflow-x-auto border border-line bg-panel print:border-0 print:bg-transparent`}
          // Wider than the page's column when the tree needs it, up to the window less its margins, centered on the page.
          style={{ width: `min(calc(100vw - 2rem), ${geo.width + 2}px)`, marginLeft: `calc(50% - min(calc(100vw - 2rem), ${geo.width + 2}px) / 2)` }}
        >
          <div className="relative mx-auto" style={{ width: geo.width, height: geo.height, ...(fit && scale < 1 ? { zoom: scale } : {}) }}>
            {data.columns.map((label, c) => (
              <p key={c} className="absolute top-0 flex h-[26px] items-center justify-center font-num text-[14px] font-bold uppercase tracking-wide text-navy" style={{ left: geo.x(c), width: geo.boxW }}>
                {label}
              </p>
            ))}
            {data.groups.map((g) => (
              <p
                key={`${g.half}-${g.label}`}
                className="absolute flex items-center justify-center font-num text-[13px] font-bold uppercase tracking-widest text-muted [writing-mode:vertical-rl]"
                style={{ left: g.half === "left" ? 0 : geo.width - geo.gutter, width: geo.gutter, top: geo.y(g.top), height: geo.y(g.bottom) - geo.y(g.top) + geo.boxH, ...(g.half === "left" ? { transform: "rotate(180deg)" } : {}) }}
              >
                {g.label}
              </p>
            ))}
            <svg aria-hidden="true" className="absolute inset-0 overflow-visible" width={geo.width} height={geo.height}>
              {data.links.map((l) => {
                const [from, to] = [byId.get(l.from)!, byId.get(l.to)!];
                const on = lit && onPath(l.from) && onPath(l.to) && (lit.path.has(l.from) || lit.ahead.has(l.from));
                return <path key={`${l.from}-${l.to}`} d={geo.link(from, to)} fill="none" stroke={on ? "var(--color-navy)" : "var(--color-line)"} strokeWidth={on ? 3 : 1.5} />;
              })}
            </svg>
            {data.boxes.map((b) => (
              <BoxView key={b.id} box={b} live={liveOf(b)} team={team} dim={!onPath(b.id)} onTeam={onTeam} max={max} style={{ position: "absolute", left: geo.x(b.col), top: geo.y(b.row), width: geo.boxW }} />
            ))}
          </div>
        </div>
      )}

      <div data-rounds className={`${roundsShown} mt-2 print:hidden`}>
        <nav aria-label="Rounds of the drawing" className="sticky top-0 z-20 -mx-4 flex overflow-x-auto border-b-2 border-navy bg-page px-4">
          {data.rounds.map((r, i) => (
            <button key={r.round} type="button" aria-current={i === current ? "true" : undefined} onClick={() => goRound(i)} className={`${btn(i === current)} shrink-0 font-num text-[16px] uppercase tracking-wide`}>
              {r.label}
            </button>
          ))}
        </nav>
        <div ref={strip} onScroll={onStrip} className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 py-3">
          {data.rounds.map((r) => (
            <div key={r.round} role="group" aria-label={r.label} className="w-[85%] max-w-[360px] shrink-0 snap-start">
              <h3 className="sr-only">{r.label}</h3>
              <ul className="grid gap-3">
                {r.ids.map((id) => (
                  <li key={id}>
                    <BoxView box={byId.get(id)!} live={liveOf(byId.get(id)!)} team={team} dim={!onPath(id)} onTeam={onTeam} max={max} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
