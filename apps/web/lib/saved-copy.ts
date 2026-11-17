import { gameNight } from "./game-night.ts";

// The words for a page the service worker served from its saved copies (ADR 0096). Plain functions, so the node tests run them as
// they are; the state they describe is in saved-copy-state.ts.

const central = (at: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...options }).format(at).replace(/ /g, " ");

/** "7:42 PM", Central time, with the weekday ("Fri 7:42 PM") when it was not saved on `now`'s Central day. */
function savedTime(savedAt: number, now: number): string {
  const at = new Date(savedAt);
  const sameDay = central(at, { year: "numeric", month: "numeric", day: "numeric" }) === central(new Date(now), { year: "numeric", month: "numeric", day: "numeric" });
  return `${sameDay ? "" : `${central(at, { weekday: "short" })} `}${central(at, { hour: "numeric", minute: "2-digit" })}`;
}

/** The notice on a saved copy. Offline it is the sentence the fan expects; on a weak signal (the page was slow, so the copy was
 * shown) it says that instead of "offline", and the worker keeps trying. */
export function savedCopyNotice({ savedAt, now, online }: { savedAt: number; now: number; online: boolean }): string {
  return `Saved copy from ${savedTime(savedAt, now)}. ${online ? "Weak signal" : "You're offline"}; scores may have changed.`;
}

/** A page that loaded from the network, then lost the signal: it was current when it loaded. */
export const OFFLINE_NOTICE = "You're offline. Scores on this page may have changed.";
/** Shown for a few seconds after a saved copy is replaced by a fresh page. */
export const BACK_ONLINE = "Back online — updated";

/** "412 KB", or "1.3 MB" from a megabyte up. */
export const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The pages to save ahead of a game night: the board, tonight's list and this round's bracket, then the game page of each followed
 * team's next game that is on tonight (`nextGames`, from /my-teams/<slug>). Only paths the worker will save (sw-rules.ts canSave). */
export function tonightPages(nextGames: ({ date?: string; href?: string } | null | undefined)[], now: Date, canSave: (path: string) => boolean): string[] {
  const night = gameNight(now);
  const games = nextGames.flatMap((g) => (g?.date === night && g.href ? [g.href] : []));
  return [...new Set(["/scores", "/scores/tonight", "/playoffs/this-round", ...games])].filter(canSave).slice(0, 12);
}

/** True when one of `nextGames` is on tonight's game night: the day a visit pre-saves. */
export const gameToday = (nextGames: ({ date?: string } | null | undefined)[], now: Date) => nextGames.some((g) => g?.date === gameNight(now));
