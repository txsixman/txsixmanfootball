import Link from "next/link";
import { programFor, type Alignment } from "@/lib/alignments";
import { fanPosts } from "@/lib/auth/config";
import type { Side } from "@/lib/bracket-fill";
import { sideText } from "@/lib/bracket-fill";
import type { BracketRow, BuiltRow } from "@/lib/brackets";
import { gameDay } from "@/lib/game-day";
import { bracketGames, builtGamePages } from "@/lib/game-pages";
import { EMPTY, type loadIdentities } from "@/lib/identity";
import { gameStatus } from "@/lib/playoff-status";
import { projectionParts } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { KickoffStatus } from "../kickoff-status";
import { CommentCountLink } from "../scores/comment-count";
import { SiteAddress } from "../scores/directions";
import { CrestSlot } from "../ui";

const day = gameDay;

/** The mark on a final the sources give different winners (ADR 0040): bordered, so it reads on a phone in the sun. */
export const DisputedMark = () => (
  <span className="inline-block border-2 border-ink px-1.5 text-[13px] font-bold uppercase leading-5 tracking-wide text-ink">Disputed</span>
);

/** The games of one round: away team first, a big score, the date and site, a status line and the projection for a game not yet played.
 * A final is confirmed (ADR 0040); `today` is a Central-time date (lib/playoff-status.ts).
 * `showStatus` is off for a past season, where every game is old and the page says once that its scores are unconfirmed
 * (a forfeit still says so). `comments` (a current season's lists only) links each game that has a page to its comments
 * (ADR 0078): "count" only when the game has some, "always" also "Comments" for one with none while posts are open. */
export async function GameList({ games, league, alignments, identities, today, showStatus = true, comments: asked }: {
  games: BracketRow[]; league: string; alignments: Alignment[]; identities: Awaited<ReturnType<typeof loadIdentities>>; today: string; showStatus?: boolean; comments?: "count" | "always";
}) {
  // The page id of each game that has one (a game the bracket only sets has none), by the same key the bracket page uses.
  // Read when the page renders (at build for a static page, as the game page reads it for its comments block): with posts off
  // nothing asks the counts route, which would answer 404 (ADR 0052) and log an error in the browser.
  const comments = fanPosts() ? asked : undefined;
  const pages = comments ? new Map((await bracketGames()).filter((g) => g.id.startsWith(`${CURRENT_SEASON}-`)).map((g) => [`${g.date}|${g.home.name}|${g.away.name}`, g.id])) : undefined;
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
          <Link href={`/programs/${slug}`} prefetch={false} className="flex min-h-11 min-w-0 flex-1 items-center hover:text-navy hover:underline">
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
        const pageId = pages?.get(`${g.date}|${g.home}|${g.away}`);
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
              {/* Where a game not yet played is, when the game details have it (ADR 0041), with directions (ADR 0066). */}
              {g.site && <span className="block">Site: {g.site}</span>}
              {g.site && g.address && <SiteAddress site={g.site} address={g.address} />}
              {/* The projection is the line a fan wants, so it gets a line of its own. */}
              {proj && (
                <span className="block font-semibold text-navy">
                  <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
                </span>
              )}
            </p>
            {/* A sibling of the team links, never inside one; draws nothing until the counts answer, and never with posts off. */}
            {pageId && <CommentCountLink gameKey={pageId} matchup={`${g.away} vs ${g.home}`} alwaysWhenOpen={comments === "always"} className="flex pl-12" />}
          </li>
        );
      })}
    </ul>
  );
}

/** Next-round games no site lists yet (ADR 0047): both winners, or the winner so far and the game it waits on. Its day, kickoff and site once the read finds them (ADR 0067), else no date or
 * site (none is listed), and the projection on a neutral field once both teams are known. A listing replaces the row.
 * `comments` as GameList's: a game with both teams known has its own page (ADR 0079), so it links to its comments. */
export async function BuiltList({ games, league, alignments, identities, comments: asked }: {
  games: BuiltRow[]; league: string; alignments: Alignment[]; identities: Awaited<ReturnType<typeof loadIdentities>>; comments?: "count" | "always";
}) {
  // The page of each game with both teams known, by its round and two teams in either order (lib/game-pages.ts builtGamePages).
  const comments = fanPosts() ? asked : undefined;
  const pairOf = (round: string, x: string, y: string) => [round, ...[x, y].sort()].join("|");
  const pages = comments ? new Map((await builtGamePages()).map((g) => [pairOf(g.round ?? "", g.home.name, g.away.name), g.id])) : undefined;
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
      <Link href={`/programs/${slug}`} prefetch={false} className="flex min-h-11 min-w-0 items-center hover:text-navy hover:underline">
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
        const [x, y] = g.sides;
        const pageId = "team" in x && "team" in y ? pages?.get(pairOf(g.round, x.team, y.team)) : undefined;
        return (
          <li key={g.sides.map(sideText).join("|")} data-built className="min-w-0 border-b border-dashed border-line px-3 py-1 text-[16px] text-ink">
            {side(g.sides[0])}
            {side(g.sides[1])}
            {g.date ? (
              <p className="pl-12 text-[14px] leading-6 text-muted">
                {/* The day, kickoff and site the read found for this pairing before any listing has it (ADR 0067). */}
                Next game · {day(g.date)}
                <span className="flex flex-wrap items-center gap-x-2">
                  <KickoffStatus date={g.date} kickoff={g.kickoff} className="font-semibold" />
                </span>
                <span className="block">{g.site ? `Site: ${g.site}` : "Site not listed yet"}</span>
                {g.site && g.address && <SiteAddress site={g.site} address={g.address} />}
              </p>
            ) : (
              <p className="pl-12 text-[14px] leading-6 text-muted">Next game · date and site not listed yet</p>
            )}
            {proj && (
              <p className="pb-1.5 pl-12 text-[14px] font-semibold leading-6 text-navy">
                <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
              </p>
            )}
            {/* As on a listed game: a sibling of the team links, nothing until the counts answer, never with posts off. */}
            {pageId && <CommentCountLink gameKey={pageId} matchup={`${sideText(x)} vs ${sideText(y)}`} alwaysWhenOpen={comments === "always"} className="flex pl-12" />}
          </li>
        );
      })}
    </ul>
  );
}
