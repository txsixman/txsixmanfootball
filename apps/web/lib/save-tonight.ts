import type { MyTeam } from "./my-teams";
import { gameToday, tonightPages } from "./saved-copy.ts";
import { canSave } from "./sw-rules.ts";

// Saving a game night's pages ahead of time (ADR 0096): the board, tonight's list, this round's bracket and the game page of each
// followed team's game that is on tonight. The service worker fetches and keeps them ("save" message, sw.ts); this asks it,
// and reports what it kept and what that cost in storage (the size as stored; the download is about a ninth of it, compressed).

export type Saved = { pages: number; bytes: number };
type NextGame = NonNullable<MyTeam["next"]>;

/** Each followed program's next game, from the same small files "My teams" reads (app/my-teams/[slug]). A program that fails is left out. */
export async function nextGamesOf(slugs: string[]): Promise<NextGame[]> {
  const teams = await Promise.all(
    slugs.slice(0, 12).map((slug) =>
      fetch(`/my-teams/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10_000) })
        .then((res) => (res.ok ? (res.json() as Promise<MyTeam>) : undefined))
        .catch(() => undefined),
    ),
  );
  return teams.flatMap((t) => (t?.next ? [t.next] : []));
}

/** The pages to save for `nextGames` tonight, and whether any of them is on tonight (the day a visit saves by itself). */
export const planTonight = (nextGames: { date?: string; href?: string }[], now = new Date()) => ({ urls: tonightPages(nextGames, now, canSave), onTonight: gameToday(nextGames, now) });

/** Asks the service worker to save `urls`. Null when there is no worker to ask (not installed yet, or this browser has none) or it did not answer. */
export async function savePages(urls: string[]): Promise<Saved | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((resolve) => setTimeout(resolve, 5_000))]);
  const worker = registration?.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 60_000);
    channel.port1.onmessage = (event: MessageEvent<Partial<Saved>>) => {
      clearTimeout(timer);
      const { pages, bytes } = event.data ?? {};
      resolve(typeof pages === "number" && typeof bytes === "number" ? { pages, bytes } : null);
    };
    worker.postMessage({ type: "save", urls }, [channel.port2]);
  });
}

const STORE = "tx6-saved-tonight";
const SAME_AFTER_MS = 20 * 60_000;

/** What this phone last saved for exactly these pages, if that was under 20 minutes ago: a second visit does not download them again. */
export function recentSave(urls: string[], now = Date.now()): Saved | null {
  try {
    const last = JSON.parse(localStorage.getItem(STORE) ?? "null") as { at: number; urls: string; pages: number; bytes: number } | null;
    return last && last.urls === urls.join(" ") && now - last.at < SAME_AFTER_MS ? { pages: last.pages, bytes: last.bytes } : null;
  } catch {
    return null;
  }
}

export function rememberSave(urls: string[], saved: Saved, now = Date.now()) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ at: now, urls: urls.join(" "), ...saved }));
  } catch {
    // Private browsing: the next visit simply saves again.
  }
}

/** "Saved for tonight: 4 pages, 640 KB on this phone, so they open with no signal." */
export const savedLine = (s: Saved, sizeText: (bytes: number) => string) =>
  `Saved for tonight: ${s.pages} ${s.pages === 1 ? "page" : "pages"}, ${sizeText(s.bytes)} on this phone, so they open with no signal.`;
