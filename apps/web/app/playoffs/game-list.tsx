import Link from "next/link";
import { programFor, type Alignment } from "@/lib/alignments";
import type { Side } from "@/lib/bracket-fill";
import { sideText } from "@/lib/bracket-fill";
import type { BracketRow, BuiltRow } from "@/lib/brackets";
import { EMPTY, type loadIdentities } from "@/lib/identity";
import { gameStatus } from "@/lib/playoff-status";
import { projectionParts } from "@/lib/projection";
import { KickoffStatus } from "../kickoff-status";
import { CrestSlot } from "../ui";

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** The mark on a final the sources give different winners (ADR 0040): bordered, so it reads on a phone in the sun. */
export const DisputedMark = () => (
  <span className="inline-block border-2 border-ink px-1.5 text-[13px] font-bold uppercase leading-5 tracking-wide text-ink">Disputed</span>
);

/** The games of one round: away team first, a big score, the date and site, a status line and the projection for a game not yet played.
 * A final is confirmed (ADR 0040); `today` is a Central-time date (lib/playoff-status.ts).
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
                  {/* Not yet played: its kickoff status, worked out in the browser when the page is viewed (ADR 0036). */}
                  {["scheduled", "tonight", "awaiting"].includes(status.kind) ? (
                    <KickoffStatus date={g.date} kickoff={g.kickoff} className="font-semibold" />
                  ) : (
                    <span className="font-semibold text-ink">{status.label}</span>
                  )}
                  {showStatus && status.unconfirmed && <DisputedMark />}
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

/** Next-round games no site lists yet (ADR 0047): both winners, or the winner so far and the game it waits on. No date or
 * site (none is listed), and the projection on a neutral field once both teams are known. A listing replaces the row. */
export function BuiltList({ games, league, alignments, identities }: { games: BuiltRow[]; league: string; alignments: Alignment[]; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  // Each side on its own line like a listed game's: a team with its crest (one tap target, its program page), or the game
  // whose winner it will be, in words beside an empty crest place.
  const side = (s: Side) => {
    const slug = "team" in s ? programFor(alignments, s.team, league)?.slug : undefined;
    const label = (
      <>
        {"team" in s ? <CrestSlot school={s.team} identity={(slug && identities.get(slug)) || EMPTY} /> : <span aria-hidden="true" className="mr-2 w-10 shrink-0" />}
        <span className="line-clamp-2 min-w-0 leading-tight">{sideText(s)}</span>
      </>
    );
    return slug ? (
      <Link href={`/programs/${slug}`} className="flex min-h-11 min-w-0 items-center hover:text-navy hover:underline">
        {label}
      </Link>
    ) : (
      <span className="flex min-h-11 min-w-0 items-center">{label}</span>
    );
  };
  return (
    <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {games.map((g) => {
        const proj = g.projection && projectionParts(g.projection);
        return (
          <li key={g.sides.map(sideText).join("|")} data-built className="min-w-0 border-b border-dashed border-line px-3 py-1 text-[16px] text-ink">
            {side(g.sides[0])}
            {side(g.sides[1])}
            <p className="pl-12 text-[14px] leading-6 text-muted">Next game · date and site not listed yet</p>
            {proj && (
              <p className="pb-1.5 pl-12 text-[14px] font-semibold leading-6 text-navy">
                <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
