import { useSyncExternalStore } from "react";

// Whether the page on screen is a saved copy (the service worker served it from its cache, ADR 0096) and whether the phone is
// online, shared by everything that shows or asks for a live score: a saved copy shows none and asks for none.

type State = { saved: { savedAt: number } | null; online: boolean };
let state: State = { saved: null, online: true };
const listeners = new Set<() => void>();
const SERVER: State = state;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const setSavedCopy = (savedAt: number | null) => {
  if (savedAt !== (state.saved?.savedAt ?? null)) set({ saved: savedAt === null ? null : { savedAt } });
};
export const setOnline = (online: boolean) => online !== state.online && set({ online });

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => state;
const server = () => SERVER;

/** The saved copy on screen: when it was saved (ms), or null for a page that came from the network. */
export const useSavedCopy = () => useSyncExternalStore(subscribe, snapshot, server).saved;
/** False while the phone is offline. */
export const useOnline = () => useSyncExternalStore(subscribe, snapshot, server).online;
/** True when nothing should ask for a live score: the page is a saved copy, or the phone is offline. */
export const useLiveBlocked = () => {
  const s = useSyncExternalStore(subscribe, snapshot, server);
  return s.saved !== null || !s.online;
};

/** Ask the service worker whether `path`, as this page was served, is a saved copy and from when (ms); null when it is not. */
export async function askSavedCopy(path: string): Promise<number | null> {
  const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event: MessageEvent<{ savedAt?: unknown }>) => {
      clearTimeout(timer);
      const at = event.data?.savedAt;
      resolve(typeof at === "number" && at > 0 ? at : null);
    };
    worker.postMessage({ type: "saved-copy?", path, offline: !navigator.onLine }, [channel.port2]);
  });
}
