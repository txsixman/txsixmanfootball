import Link from "next/link";
import { programFor, type Alignment } from "@/lib/alignments";
import type { BracketRow } from "@/lib/brackets";
import { EMPTY, type loadIdentities } from "@/lib/identity";
import { gameStatus } from "@/lib/playoff-status";
import { projectionParts } from "@/lib/projection";
import { CrestSlot, UnconfirmedMark } from "../ui";

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** The games of one round: away team first, a big score, the date and site, a status line and the projection for a game not yet played.
 * No row names a winner from an unconfirmed score (ADR 0004); `today` is a Central-time date (lib/playoff-status.ts).
 * `showStatus` is off for a past season, where every game is old and the page says once that its scores are unconfirmed
 * (a forfeit still says so). */
export function GameList({ games, league, alignments, identities, today, showStatus = true }: {
  games: BracketRow[]; league: string; alignments: Alignment[]; identities: Awaited<ReturnType<typeof loadIdentities>>; today: string; showStatus?: boolean;
}) {
  const team = (name: string, score: number | undefined) => {
    const slug = programFor(alignments, name, league)?.slug;
    // The crest and name are one tap target (the program page); a team missing from today's alignments is plain text.
    const label = (
      <>
        <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />
        <span className="line-clamp-2 min-w-0 leading-tight">{name}</span>
      </>
    );
    return (
      <span className="flex min-h-11 items-center">
        {slug ? (
          <Link href={`/programs/${slug}`} className="flex min-h-11 min-w-0 flex-1 items-center hover:text-navy hover:underline">
            {label}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center">{label}</span>
        )}
        <span className="w-14 shrink-0 text-right font-num text-[30px] font-bold leading-none tabular-nums">{score ?? ""}</span>
      </span>
    );
  };
  return (
    <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {games.map((g) => {
        const status = gameStatus(g, today);
        const proj = g.projection && !g.forfeit ? projectionParts(g.projection) : undefined;
        return (
          <li key={`${g.date}-${g.home}-${g.away}`} className="min-w-0 border-b border-line px-3 py-1 text-[16px] text-ink">
            {team(g.away, g.forfeit ? undefined : g.awayScore)}
            {team(g.home, g.forfeit ? undefined : g.homeScore)}
            <p className="pb-1.5 pl-12 text-[14px] leading-6 text-muted">
              {day(g.date)}
              {g.neutral ? "" : ` · at ${g.home}`}
              {(showStatus || g.forfeit) && (
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className={status.kind === "tonight" ? "bg-red px-1.5 font-bold text-white" : "font-semibold text-ink"}>{status.label}</span>
                  {showStatus && status.unconfirmed && <UnconfirmedMark />}
                </span>
              )}
              {/* The projection is the line a fan wants, so it gets a line of its own. */}
              {proj && (
                <span className="block font-semibold text-navy">
                  <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
