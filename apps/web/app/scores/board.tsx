"use client";

import { CalendarClock, Check, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Game } from "@/lib/demo-games";
import type { Identity } from "@/lib/identity"; // the type only: lib/identity.ts reads files
import { asLive, liveStatus, liveView, type LiveView } from "@/lib/live-scores";
import { kickoffState } from "@/lib/kickoff";
import { ORGS } from "@/lib/orgs";
import { projectedLine } from "@/lib/outcome";
import { isForfeit, outcomeOf, winnerOf, type Side } from "@/lib/score-display";
import { CrestSlot, EmptyState, PageHeader, UnconfirmedMark } from "../ui";
import { KickoffStatus, useNow } from "../kickoff-status";
import { ScoresChecked } from "./freshness";
import { useLiveScores } from "./live-score";
import { ForfeitMark, VerifyBar, scoreClass } from "./parts";

function StatusCell({ g }: { g: Game }) {
  const base = "flex w-[68px] shrink-0 flex-col justify-center self-stretch px-2 font-num text-[14px] font-bold uppercase leading-4 tracking-wide";
  if (g.state === "live") {
    return (
      <div className={`${base} bg-red text-white`}>
        <span>Live</span>
        <span>{/half/i.test(g.status) ? "Half" : g.status}</span>
      </div>
    );
  }
  if (g.state === "final") {
    return (
      <div className={`${base} border-r border-line text-navy`}>
        {g.verification === "confirmed" ? (
          <span className="flex items-center gap-0.5">
            Final
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
            <span className="sr-only">confirmed</span>
          </span>
        ) : (
          // Not confirmed (a disputed score): never "Final", which would name a winner (ADR 0040).
          <>
            <span>Score</span>{" "}
            <span>reported</span>
          </>
        )}
      </div>
    );
  }
  if (g.state === "postponed") return <div className={`${base} border-r border-line text-[13px] tracking-normal text-red`}>Postponed</div>;
  // A real game not yet played: its date, then its kickoff status at the moment of viewing (ADR 0036). An invented sample
  // game keeps its written time.
  if (g.state === "scheduled" && g.date) {
    return (
      <div className={`${base} border-r border-line text-ink`}>
        <span>{g.status}</span>
        <KickoffStatus date={g.date} kickoff={g.kickoff} short className="mt-0.5 w-fit text-[13px] leading-4" />
      </div>
    );
  }
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
  // What was projected beside what happened (ADR 0044): before the game, the projection alone; after, "Final: …", "Forfeit"
  // or "Disputed"; under way, "Now: …". No upset label.
  const line = projectedLine(g.projected, outcomeOf(g));
  // An unconfirmed score (a live one) is marked once, in the row, by the same mark as every other page. A full-width red bar
  // under each game read as an alarm. A "Now: … · Unconfirmed" line already says it, so it takes no second mark; a disputed
  // score keeps its bar (VerifyBar).
  if (g.verification === "unconfirmed" && !line?.includes("Unconfirmed")) {
    items.unshift(
      <span key="v" className="flex items-center gap-1.5">
        <UnconfirmedMark />
        {g.sources && <span className="text-muted">{g.sources}</span>}
      </span>,
    );
  }
  if (line) items.push(<span key="r" data-projected className="text-muted">{line}</span>);
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

/** `live`: the live read of a game under way (asLive put its score in the score cells; this says where the game stands). */
function Row({ g, crests, live }: { g: Game; crests?: Crests; live?: LiveView }) {
  const edge = g.verification === "disputed" ? "border-l-[6px] border-red" : "border-l-[6px] border-transparent";
  return (
    <li data-game={g.id} className="border-b border-line">
      <Link href={`/scores/${g.id}`} className="block hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy active:bg-panel">
        <div className={`flex min-h-16 ${edge}`}>
          <StatusCell g={g} />
          <div className="min-w-0 flex-1 py-1.5 pl-2.5 pr-3">
            <TeamLine g={g} side="away" crests={crests} />
            <TeamLine g={g} side="home" crests={crests} />
            <Notes g={g} />
            {live && (
              <p data-live-score className="mt-0.5 font-num text-[14px] font-bold uppercase leading-4 tracking-wide text-red">
                {liveStatus(live)}
              </p>
            )}
          </div>
        </div>
        {g.verification === "disputed" && <VerifyBar g={g} />}
      </Link>
    </li>
  );
}

function Section({ id, title, live, games, crests, checked }: { id: string; title: string; live?: boolean; games: Game[]; crests?: Crests; checked: Map<string, LiveView> }) {
  if (!games.length) return null;
  const leagues = [...new Set(games.map((g) => g.league))];
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[45px]">
      <h2 id={`${id}-h`} className={`px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white ${live ? "bg-red" : "bg-navy"}`}>
        {title}
      </h2>
      {leagues.map((league) => (
        <div key={league}>
          <h3 className="sticky top-[45px] z-10 border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
            {league}
          </h3>
          <ul>
            {games.filter((g) => g.league === league).map((g) => (
              <Row key={g.id} g={g} crests={crests} live={checked.get(g.id)} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A game's organization (ADR 0012): its league label starts with it ("UIL DI · Bi-district", "TCAF · Final"). */
const orgOf = (g: Game) => ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `));

/** A next-round game the bracket sets before any site lists it (ADR 0047): "Team vs winner of X–Y", or both teams and the projection. */
export type NextGame = { key: string; org: string; heading: string; sides: [{ name: string; href?: string }, { name: string; href?: string }]; projected?: string };

function NextSection({ games }: { games: NextGame[] }) {
  if (!games.length) return null;
  return (
    <section id="next" aria-labelledby="next-h" className="scroll-mt-[45px]">
      <h2 id="next-h" className="bg-navy px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white">Next games</h2>
      {[...new Set(games.map((g) => g.heading))].map((heading) => (
        <div key={heading}>
          <h3 className="sticky top-[45px] z-10 border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">{heading}</h3>
          <ul>
            {games.filter((g) => g.heading === heading).map((g) => (
              <li key={g.key} data-built className="border-b border-dashed border-line px-3 py-2 text-ink">
                <p className="text-[17px] font-bold leading-tight">
                  {g.sides.map((s, i) => (
                    <span key={s.name}>
                      {i > 0 && " vs "}
                      {s.href ? <Link href={s.href} className="name-link">{s.name}</Link> : s.name}
                    </span>
                  ))}
                </p>
                <p className="text-[14px] leading-6 text-muted">Set by the bracket · date and site not listed yet</p>
                {g.projected && <p className="text-[14px] font-semibold leading-6 text-navy">Projected: {g.projected}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** `weekInReview`: a link to the newest week in review, on the live page only (the sample page stays as it is). `next`: games the bracket sets (live page only). */
export default function Board({ games, eyebrow, title, crests, weekInReview, next = [] }: { games: Game[]; eyebrow: string; title: string; crests?: Crests; weekInReview?: { href: string; label: string }; next?: NextGame[] }) {
  const [query, setQuery] = useState("");
  // Only a game with a date and no final can be under way, and only inside its kickoff window; invented sample games or finals ask for nothing.
  const liveRows = useLiveScores(games.flatMap((g) => (g.date && g.state === "scheduled" ? [{ date: g.date, kickoff: g.kickoff }] : [])));
  // A game with no final that has a live row is under way (ADR 0021): it is counted and listed as Live, its score in its own
  // cells, unconfirmed, with no winner, its projection beside the score so far (asLive). A game with a final never takes a live row.
  const checked = new Map<string, LiveView>();
  const boardGames = games.map((g) => {
    const live = g.state === "scheduled" ? liveView(liveRows, { date: g.date, home: g.home.name, away: g.away.name }) : null;
    if (!live) return g;
    checked.set(g.id, live);
    return asLive(g, live);
  });
  // One button per organization that has games, in the site's order (UIL first, the default). Never an "All".
  const orgs = ORGS.filter((o) => boardGames.some((g) => orgOf(g) === o));
  const [chosen, setChosen] = useState("");
  const org = orgs.find((o) => o.slug === chosen) ?? orgs[0];
  const inOrgGames = org ? boardGames.filter((g) => orgOf(g) === org) : [];
  const q = query.trim().toLowerCase();
  const shown = q ? inOrgGames.filter((g) => `${g.home.name} ${g.away.name}`.toLowerCase().includes(q)) : inOrgGames;
  const live = shown.filter((g) => g.state === "live");
  const final = shown.filter((g) => g.state === "final" && g.verification === "confirmed");
  const reported = shown.filter((g) => g.state === "final" && g.verification !== "confirmed");
  // A game past its window with no score is not "Later" (ADR 0046): it is listed as "Score not reported yet", as its row's
  // status cell says. Worked out at the moment of viewing (ADR 0036); before that (the server, the first render) it is Later.
  const now = useNow();
  const awaiting = (g: Game) => g.state === "scheduled" && !!g.date && now !== null && kickoffState({ date: g.date, kickoff: g.kickoff }, now).kind === "awaiting";
  const notReported = shown.filter(awaiting);
  const later = shown.filter((g) => (g.state === "scheduled" || g.state === "postponed") && !awaiting(g));
  const nextShown = next.filter((g) => org && g.org === org.league && (!q || g.sides.some((s) => s.name.toLowerCase().includes(q))));
  const jumps = [
    { href: "#live", label: "Live", n: live.length },
    { href: "#reported", label: "Reported", n: reported.length },
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
                  org === o ? "bg-navy text-white" : "text-navy hover:bg-panel"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <ScoresChecked games={games} className="border-b border-line px-3 py-1.5" />

      {weekInReview && (
        <Link href={weekInReview.href} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
          {weekInReview.label}
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>
      )}

      <nav aria-label="Jump to" className="sticky top-0 z-20 flex h-[45px] border-b border-line bg-white">
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

      <Section id="live" title="Live now" live games={live} crests={crests} checked={checked} />
      <Section id="reported" title="Score reported" games={reported} crests={crests} checked={checked} />
      <Section id="final" title="Final" games={final} crests={crests} checked={checked} />
      <Section id="not-reported" title="Score not reported yet" games={notReported} crests={crests} checked={checked} />
      <Section id="later" title="Later" games={later} crests={crests} checked={checked} />
      <NextSection games={nextShown} />
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
          <dd>Boxed word, dashed score. A live score, not final yet.</dd>
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
