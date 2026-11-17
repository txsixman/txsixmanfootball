"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { geometry } from "@/lib/bracket-layout";
import { liveView, type LiveView } from "@/lib/live-scores";
import { openRound, pathSteps, whosLeft } from "@/lib/whos-left";
import { useLiveScores } from "../../scores/live-score";
import { ShareButton } from "../../share-button";
import type { Box, BoxSide, TreeData } from "./data";
import { footer, SideRow } from "./parts";
import { RoundTabs } from "./rounds";
import { WhosLeft } from "./whos-left";

// The bracket drawn (ADR 0049). Two views of the same boxes: the whole tree (rounds as columns, both halves meeting at the
// final, connectors from each pair of games to the one they feed) and one round at a time (round tabs and the round's games
// as cards, rounds.tsx, ADR 0094). Wide screens open on the tree, phones on the rounds; either can switch. Tapping a team
// lights its path, games played and the route ahead, and lists that road; tapping a game opens its page. "Who's left" (whos-left.tsx)
// lists the teams still in. A game under way shows its live
// score in place, unconfirmed (ADR 0021). Every box is real text and every control a button or link, so it reads with a
// keyboard and a screen reader; the round-by-round list below the drawing holds the same games.

type View = "auto" | "tree" | "rounds";
const NO_TITLES: Record<string, { text: string; chance: number }> = {};

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
        <Link href={box.href} prefetch={false} className="absolute inset-0 hover:bg-panel/60" aria-label={`${box.code ? `${box.code}, ` : ""}${box.label}: ${box.sides.map((s) => s.text).join(" vs ")}. Game page`} />
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
export function BracketBoard({ data, imageBase, list = true, current: named, titles = NO_TITLES }: {
  data: TreeData; imageBase: string | null; list?: boolean;
  /** The round the page calls current (lib/playoff-status.ts currentRound), by its key: the tab the rounds view opens on. */
  current?: string;
  /** Each team's chance to win the State Championship as the page words it, and as a number to order by, by program slug. */
  titles?: Record<string, { text: string; chance: number }>;
}) {
  const [view, setView] = useState<View>(data.whole ? "auto" : "rounds");
  const [team, setTeam] = useState<string | null>(null);
  const [fit, setFit] = useState(false);
  const [scale, setScale] = useState(1);
  // The round being played: the page's own pick (by date), else the first with a game still to play, else the last. The rounds
  // view opens on it, so a phone on game night lands on this week's games, not the first round's finals.
  const playing = useMemo(() => openRound(data, named), [data, named]);
  const [current, setCurrent] = useState(playing);
  const [wide, setWide] = useState<boolean | null>(null); // null until the browser says, so the server's page matches
  const [copied, setCopied] = useState(false);
  const treeBox = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
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

  const pick = (v: View) => {
    setView(v);
    if (v === "tree" && window.matchMedia("(max-width: 767px)").matches) setFit(true); // the phone's whole bracket opens fitted
  };
  const treeShown = view === "tree" ? "block" : view === "rounds" ? "hidden" : "hidden md:block";
  const roundsShown = view === "rounds" ? "block" : view === "tree" ? "hidden" : "md:hidden";
  const btn = (on: boolean) => `inline-flex min-h-11 items-center px-3 text-[14px] font-bold ${on ? "bg-band text-white" : "text-navy hover:bg-panel"}`;
  const printZoom = geo.width ? Math.min(1, 995 / geo.width, 700 / geo.height) : 1;
  const teamSide = team ? data.boxes.flatMap((b) => b.sides).find((s) => s.key === team) : undefined;
  const [teamName, teamProgram] = [teamSide?.text, teamSide?.program];
  const steps = useMemo(() => (team ? pathSteps(data, team) : []), [data, team]);
  const left = useMemo(
    () => whosLeft(data, Object.fromEntries(Object.entries(titles).map(([k, v]) => [k, v.text])), Object.fromEntries(Object.entries(titles).map(([k, v]) => [k, v.chance]))),
    [data, titles],
  );
  // "Light its path" in the list: light it, then go up to the line that says so (the drawing is above the list).
  const follow = (key: string) => {
    setTeam(key);
    status.current?.scrollIntoView({ block: "start" });
  };

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
            <button type="button" aria-pressed={shown === "tree"} onClick={() => pick("tree")} className={`${btn(view === "tree")} ${view === "auto" ? "md:bg-band md:text-white" : ""}`}>
              Whole bracket
            </button>
            <button type="button" aria-pressed={shown === "rounds"} onClick={() => pick("rounds")} className={`${btn(view === "rounds")} ${view === "auto" ? "max-md:bg-band max-md:text-white" : ""}`}>
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
      <p ref={status} data-print-hide className="mt-1 flex scroll-mt-14 flex-wrap items-center gap-x-3 text-[13px] text-muted" aria-live="polite">
        {teamName ? (
          <>
            <span>{teamName}&rsquo;s path is lit.</span>
            <button type="button" onClick={() => setTeam(null)} className="inline-flex min-h-11 items-center font-semibold text-navy underline">
              Clear
            </button>
            {teamProgram && (
              <Link href={`/programs/${teamProgram}#path`} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-navy underline">
                Playoff path on its page
              </Link>
            )}
          </>
        ) : (
          <span>Tap a team to light its path. Tap a game for its page.</span>
        )}
        {data.boxes.some((b) => b.sides.some((s) => s.projected)) && (
          <span data-projected-note>Dashed: the projected team, the most likely from the current ratings. A projection, not a result.</span>
        )}
        {/* The same games as a plain list, below the drawing: the way past it with a keyboard or a screen reader. */}
        {list && (
          <a href="#games-by-round" className="link-more">
            Games as a list
          </a>
        )}
      </p>
      {team && steps.length > 0 && (
        // The road of the lit team, one line a game: the games played, the one next, and what its wins would lead to. In the
        // rounds view a line opens that round.
        <details data-path-road className="mt-1 print:hidden">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy">
            Its road, game by game ({steps.length})
          </summary>
          <ol className="border-t border-line">
            {steps.map((st) => {
              const i = data.rounds.findIndex((r) => r.round === st.round);
              return (
                <li key={st.id} data-step={st.kind} className="border-b border-line text-[14px] leading-5 text-ink">
                  {shown === "rounds" ? (
                    <button type="button" onClick={() => setCurrent(i)} className="flex min-h-11 w-full items-center px-2 text-left hover:bg-panel focus-visible:outline-2 focus-visible:outline-navy">
                      {st.text}
                    </button>
                  ) : (
                    <p className="flex min-h-11 items-center px-2">{st.text}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}

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

      <div className={roundsShown}>
        <RoundTabs data={data} current={current} now={playing} onSelect={setCurrent} team={team} onPath={onPath} onTeam={onTeam} liveOf={liveOf} />
      </div>

      {/* The teams still in, below the drawing (ADR 0094): "Light its path" lights a team's road above, so the page goes back up to it. */}
      <WhosLeft rows={left} team={team} onFollow={follow} titled={Object.keys(titles).length > 0} />
    </section>
  );
}
