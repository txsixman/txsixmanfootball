"use client";

import { ArrowUpRight, CalendarClock, Check, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Game } from "@/lib/demo-games";
import type { Identity } from "@/lib/identity"; // the type only: lib/identity.ts reads files
import { liveView, type LiveRow } from "@/lib/live-scores";
import { ORGS } from "@/lib/orgs";
import { isForfeit, winnerOf, type Side } from "@/lib/score-display";
import { CrestSlot, EmptyState, PageHeader } from "../ui";
import { LiveLine, useLiveScores } from "./live-score";
import { ForfeitMark, VerifyBar, scoreClass } from "./parts";

function StatusCell({ g }: { g: Game }) {
  const base = "flex w-[68px] shrink-0 flex-col justify-center self-stretch px-2 font-num text-[14px] font-bold uppercase leading-4 tracking-wide";
  if (g.state === "live") {
    return (
      <div className={`${base} bg-alert text-white`}>
        <span>Live</span>
        <span>{/half/i.test(g.status) ? "Half" : g.status}</span>
      </div>
    );
  }
  if (g.state === "final") {
    return (
      <div className={`${base} border-r border-line text-navy`}>
        <span className="flex items-center gap-0.5">
          Final
          {g.verification === "confirmed" && (
            <>
              <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
              <span className="sr-only">confirmed</span>
            </>
          )}
        </span>
      </div>
    );
  }
  if (g.state === "postponed") return <div className={`${base} border-r border-line text-[13px] tracking-normal text-red`}>Postponed</div>;
  const [time, ampm] = g.status.split(" ");
  return (
    <div className={`${base} border-r border-line text-ink`}>
      <span>{time}</span>
      <span className="text-muted">{ampm}</span>
    </div>
  );
}

function Notes({ g }: { g: Game }) {
  const items: ReactNode[] = [];
  if (isForfeit(g)) {
    items.push(<span key="f" className="font-bold text-ink">Forfeit. Not a played score.</span>);
  } else if (g.endReason && g.state === "final") {
    items.push(<span key="e" className="font-bold uppercase tracking-wide text-navy">{g.endReason}</span>);
  } else if (g.endReason && g.state === "postponed") {
    items.push(
      <span key="p" className="flex items-center gap-1 text-ink">
        <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
        {g.endReason}
      </span>,
    );
  }
  if (g.upset) {
    items.push(
      <span key="u" className="flex items-center gap-0.5 font-bold uppercase tracking-wide text-navy">
        <ArrowUpRight aria-hidden="true" className="size-3.5" strokeWidth={3} />
        Upset
      </span>,
    );
  }
  if (g.state === "scheduled" && g.projected) items.push(<span key="r" className="text-muted">Projected: {g.projected}</span>);
  if (!items.length) return null;
  return <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] leading-4">{items}</p>;
}

/** Real schools' looks by team name (the page fills in a plain badge for a team with no identity); the invented sample
 * schools are not in it, so their lines draw no crest. */
type Crests = Record<string, Identity>;

function TeamLine({ g, side, crests }: { g: Game; side: Side; crests?: Crests }) {
  const team = g[side];
  const score = side === "home" ? g.homeScore : g.awayScore;
  const winner = winnerOf(g);
  const lost = winner !== null && winner !== side;
  const forfeit = isForfeit(g);
  return (
    <div className="flex h-7 items-center gap-2">
      {crests?.[team.name] && <CrestSlot school={team.name} identity={crests[team.name]} />}
      <span className={`min-w-0 flex-1 truncate text-[15px] leading-5 ${lost ? "font-medium text-ink/70" : "font-semibold text-ink"}`}>
        {team.rank != null && <span className="mr-1 text-[13px] font-bold text-navy">#{team.rank}</span>}
        {team.name}
        <span className="ml-1.5 text-[13px] font-normal text-muted">{team.record}</span>
      </span>
      {winner === side && !forfeit && (
        <>
          <span aria-hidden="true" className="text-[10px] leading-none text-navy">&#9664;</span>
          <span className="sr-only">winner</span>
        </>
      )}
      <span className="w-11 shrink-0 text-right font-num text-[28px] leading-none">
        {forfeit && winner ? (
          <ForfeitMark side={side} winner={winner} />
        ) : score == null || forfeit ? (
          <span className="font-semibold text-muted">
            <span aria-hidden="true">&ndash;</span>
            <span className="sr-only">no score</span>
          </span>
        ) : (
          <span className={scoreClass(g, lost)}>{score}</span>
        )}
      </span>
    </div>
  );
}

function Row({ g, crests, liveRows }: { g: Game; crests?: Crests; liveRows: LiveRow[] }) {
  // A game with no final yet may be under way (ADR 0021); one with a final never shows a live row.
  const live = g.state === "scheduled" ? liveView(liveRows, { date: g.date, home: g.home.name, away: g.away.name }) : null;
  const edge =
    g.verification === "disputed"
      ? "border-l-[6px] border-red"
      : g.verification === "unconfirmed"
        ? "border-l-[6px] border-dashed border-red"
        : "border-l-[6px] border-transparent";
  return (
    <li data-game={g.id} className="border-b border-line">
      <Link href={`/scores/${g.id}`} className="block hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy active:bg-panel">
        <div className={`flex min-h-16 ${edge}`}>
          <StatusCell g={g} />
          <div className="min-w-0 flex-1 py-1.5 pl-2.5 pr-3">
            <TeamLine g={g} side="away" crests={crests} />
            <TeamLine g={g} side="home" crests={crests} />
            <Notes g={g} />
            {live && <LiveLine live={live} className="mt-0.5" />}
          </div>
        </div>
        <VerifyBar g={g} />
      </Link>
    </li>
  );
}

function Section({ id, title, live, games, crests, liveRows }: { id: string; title: string; live?: boolean; games: Game[]; crests?: Crests; liveRows: LiveRow[] }) {
  if (!games.length) return null;
  const leagues = [...new Set(games.map((g) => g.league))];
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[45px]">
      <h2 id={`${id}-h`} className={`px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white ${live ? "bg-alert" : "bg-band"}`}>
        {title}
      </h2>
      {leagues.map((league) => (
        <div key={league}>
          <h3 className="sticky top-[45px] z-10 border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
            {league}
          </h3>
          <ul>
            {games.filter((g) => g.league === league).map((g) => (
              <Row key={g.id} g={g} crests={crests} liveRows={liveRows} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A game's organization (ADR 0012): its league label starts with it ("UIL DI · Bi-district", "TCAF · Final"). */
const orgOf = (g: Game) => ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `));

/** `weekInReview`: a link to the newest week in review, on the live page only (the sample page stays as it is). */
export default function Board({ games, eyebrow, title, crests, weekInReview }: { games: Game[]; eyebrow: string; title: string; crests?: Crests; weekInReview?: { href: string; label: string } }) {
  const [query, setQuery] = useState("");
  // Only a game with a date and no final can be under way; a board of invented sample games or finals asks for nothing.
  const liveRows = useLiveScores(games.some((g) => g.date && g.state === "scheduled"));
  // One button per organization that has games, in the site's order (UIL first, the default). Never an "All".
  const orgs = ORGS.filter((o) => games.some((g) => orgOf(g) === o));
  const [chosen, setChosen] = useState("");
  const org = orgs.find((o) => o.slug === chosen) ?? orgs[0];
  const inOrgGames = org ? games.filter((g) => orgOf(g) === org) : [];
  const q = query.trim().toLowerCase();
  const shown = q ? inOrgGames.filter((g) => `${g.home.name} ${g.away.name}`.toLowerCase().includes(q)) : inOrgGames;
  const live = shown.filter((g) => g.state === "live");
  const final = shown.filter((g) => g.state === "final");
  const later = shown.filter((g) => g.state === "scheduled" || g.state === "postponed");
  const jumps = [
    { href: "#live", label: "Live", n: live.length },
    { href: "#final", label: "Final", n: final.length },
    { href: "#later", label: "Later", n: later.length },
  ];

  return (
    <>
      <header className="border-b-2 border-navy px-3 pb-3 pt-4">
        <PageHeader eyebrow={eyebrow} title={title} />
        <label className="mt-3 flex h-11 items-center gap-2 border border-line bg-panel px-3 focus-within:outline-2 focus-within:outline-navy">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <span className="sr-only">Find a team</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a team"
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted"
          />
        </label>
        {orgs.length > 1 && (
          <div role="group" aria-label="Show games from" className="mt-2 flex gap-1.5">
            {orgs.map((o) => (
              <button
                key={o.slug}
                type="button"
                aria-pressed={org === o}
                onClick={() => setChosen(o.slug)}
                className={`min-h-11 flex-1 border-2 border-navy px-1 font-num text-[15px] font-bold uppercase tracking-wide ${
                  org === o ? "bg-band text-white" : "text-navy hover:bg-panel"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {weekInReview && (
        <Link href={weekInReview.href} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
          {weekInReview.label}
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>
      )}

      <nav aria-label="Jump to" className="sticky top-0 z-20 flex h-[45px] border-b border-line bg-page">
        {jumps.map((j) =>
          // A section with no games is not on the page, so its jump link would do nothing: show it as plain, dimmed text.
          j.n ? (
            <a key={j.href} href={j.href} className="flex flex-1 items-center justify-center gap-1.5 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
              {j.label}
              <span className={j.href === "#live" ? "text-red" : "text-muted"}>{j.n}</span>
            </a>
          ) : (
            <span key={j.href} className="flex flex-1 items-center justify-center gap-1.5 font-num text-[16px] font-semibold uppercase tracking-wide text-muted">
              {j.label}
              <span>{j.n}</span>
            </span>
          ),
        )}
      </nav>

      <Section id="live" title="Live now" live games={live} crests={crests} liveRows={liveRows} />
      <Section id="final" title="Final" games={final} crests={crests} liveRows={liveRows} />
      <Section id="later" title="Later" games={later} crests={crests} liveRows={liveRows} />
      {!shown.length && (
        <div className="px-3 pb-6">
          <EmptyState>{q ? <>No team matches &ldquo;{query.trim()}&rdquo;.</> : "No games in this organization yet."}</EmptyState>
        </div>
      )}

      <aside aria-label="How to read this page" className="border-t-2 border-navy px-3 py-3 text-[13px] leading-5 text-muted">
        <h2 className="mb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">Key</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="font-bold text-ink">Check</dt>
          <dd>A confirmed final.</dd>
          <dt className="font-bold text-ink">Unconfirmed</dt>
          <dd>Dashed score. Not confirmed yet, and it may change.</dd>
          <dt className="font-bold text-ink">Disputed</dt>
          <dd>Wavy score. Reports disagree, so no winner is marked.</dd>
          <dt className="font-bold text-ink">Forfeit</dt>
          <dd>W or L in a dashed box. No real score exists.</dd>
          <dt className="font-bold text-ink">45-point rule</dt>
          <dd>The game ended early because the lead reached 45.</dd>
          <dt className="font-bold text-ink">Projected</dt>
          <dd>A pre-game estimate of the margin, not a result.</dd>
        </dl>
      </aside>
    </>
  );
}
