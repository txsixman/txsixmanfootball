import { useEffect, useSyncExternalStore } from "react";
import { linkToAccount, pushSupported, stopHere, thisBrowserEndpoint, unsubscribeThisBrowser } from "@/lib/push";
import { removeLinkedDevice } from "./center-actions";

// What the account page knows about THIS browser's push alerts (ADR 0058): whether it has a subscription linked to the account, its
// device id (so the devices list can say "This browser"), and the teams muted on it. The page's script is the only holder of the
// endpoint: it asks /api/account/this-device and /api/account/push-mute with it, and the server answers with a device id and slugs,
// never the endpoint. The endpoint is kept here, in memory, and never rendered or logged. One shared state, so the teams list, the
// browser's status and the devices list always agree.

type ThisBrowser = {
  /** loading: not asked yet; unsupported: this browser cannot show alerts; off: no subscription linked to this account; on: linked; error: could not be asked. */
  status: "loading" | "unsupported" | "off" | "on" | "error";
  deviceId: string | null;
  muted: string[];
};

const LOADING: ThisBrowser = { status: "loading", deviceId: null, muted: [] };
let current = LOADING;
let endpoint: string | null = null;
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function publish(next: ThisBrowser) {
  current = next;
  for (const listener of listeners) listener();
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });

async function load(): Promise<void> {
  try {
    if (!pushSupported()) return publish({ status: "unsupported", deviceId: null, muted: [] });
    endpoint = await thisBrowserEndpoint();
    if (!endpoint) return publish({ status: "off", deviceId: null, muted: [] });
    const res = await post("/api/account/this-device", { endpoint });
    if (!res.ok) return publish({ status: "error", deviceId: null, muted: [] });
    const body = (await res.json()) as { id: string | null; muted?: string[] };
    publish(body.id ? { status: "on", deviceId: body.id, muted: body.muted ?? [] } : { status: "off", deviceId: null, muted: [] });
  } catch {
    publish({ status: "error", deviceId: null, muted: [] });
  }
}

/** Ask again who this browser is to the account (after turning alerts on or off, or removing this browser's device). Asks once at a time. */
export function refreshThisBrowser(): Promise<void> {
  inFlight ??= load().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** Hear every change to this browser's push state, without asking for it (the game-alerts switch re-reads its own state on each). Returns the way to stop listening. */
export function onThisBrowserChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Turn this browser's alerts off for a signed-in fan: the account's linked row for it is removed first, then the browser's own
 * subscription is stopped. A browser the account never linked is stopped the way a signed-out one is. "failed" when it could not be done.
 */
export async function turnOffHere(): Promise<"ok" | "failed"> {
  if (current.status === "loading" || current.status === "error") await refreshThisBrowser(); // not known yet (the home page): ask who this browser is
  try {
    if (current.status === "on" && current.deviceId) {
      const removed = await removeLinkedDevice(current.deviceId);
      if (!removed.ok) return "failed";
      await unsubscribeThisBrowser();
    } else if (current.status === "off") {
      await stopHere();
    } else {
      return "failed"; // "error": could not even be asked who this browser is
    }
  } catch {
    return "failed";
  }
  await refreshThisBrowser(); // every part of the page showing this browser now says off
  return "ok";
}

/** This browser's push state, shared by every part of the page that shows it. Asks when the first of them appears. */
export function useThisBrowser(): ThisBrowser {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
    () => LOADING,
  );
  useEffect(() => {
    void refreshThisBrowser();
  }, []);
  return state;
}

/** Mute or unmute one team's alerts on this browser; false when it could not be saved. The box moves at once and goes back if the save fails. */
export async function setTeamMuted(slug: string, muted: boolean): Promise<boolean> {
  if (!endpoint || current.status !== "on") return false;
  const before = current;
  publish({ ...before, muted: muted ? [...new Set([...before.muted, slug])] : before.muted.filter((s) => s !== slug) });
  try {
    const res = await post("/api/account/push-mute", { endpoint, slug, muted });
    if (!res.ok) throw new Error("mute");
    const body = (await res.json()) as { muted: string[] };
    publish({ ...current, muted: body.muted });
    return true;
  } catch {
    publish({ ...current, muted: before.muted });
    return false;
  }
}

/** Turn alerts on for this browser: asks permission if needed, subscribes and links it to the account. "blocked" when the browser's permission is denied. */
export async function turnOnHere(): Promise<"ok" | "blocked" | "failed"> {
  try {
    await linkToAccount(true);
  } catch (e) {
    return (e as Error).message === "permission" ? "blocked" : "failed";
  }
  await refreshThisBrowser();
  return "ok";
}
