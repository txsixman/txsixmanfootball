// Browser push alerts for a followed program's finals (migration 0008, tools/push/send-finals.mjs). Public values only:
// the VAPID public key (its private half is a secret in the owner's Keychain and the repo's VAPID_PRIVATE_KEY), and
// Supabase's URL and publishable key (lib/supabase-public.ts), which by design can do nothing here but call push_follow and
// push_unfollow. A signed-in fan's browser is also linked to the account (migration 0023, ADR 0054) through /api/push/link, so
// the account's follows drive its alerts; a push endpoint is a capability URL, so it is sent only to this site, never logged.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-public";

const VAPID_PUBLIC_KEY = "BIYcYxqLhhCfvjinOizccPGyBIaaIZBCZoeaRwJ9dHWXa5lRz6IXFnEUErvbb40xntsAtCPvE6R0a8zZ0_YRX_Q";

/** The programs this browser follows, kept on the device (the database will not tell an anonymous caller). */
const STORE = "followed-programs";

export function followedHere(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(list) ? list.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Forget one program in this browser's own list (the account's unfollow: the browser must not show it as followed). */
export function dropFromThisBrowser(slug: string) {
  remember(followedHere().filter((s) => s !== slug));
}

function remember(list: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    // Private mode: alerts still work; this device just forgets which buttons to show as on.
  }
}

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function rpc(name: "push_follow" | "push_unfollow", body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
}

const keyBytes = (base64url: string) => {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Ask the browser for its subscription without waiting for a service worker that may never come (no `ready`). */
async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise<undefined>((resolve) => setTimeout(resolve, 3_000))]);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** This browser's push endpoint, for sign-out to unlink it from the account; null when it has none or cannot be asked. */
export async function thisBrowserEndpoint(): Promise<string | null> {
  try {
    return pushSupported() ? ((await existingSubscription())?.endpoint ?? null) : null;
  } catch {
    return null;
  }
}

/** Stop this browser's push subscription (the Account Center's "Turn off"). The account's linked row is removed first, by the caller; false when there was nothing to stop or it could not be. */
export async function unsubscribeThisBrowser(): Promise<boolean> {
  try {
    return pushSupported() ? ((await (await existingSubscription())?.unsubscribe()) ?? false) : false;
  } catch {
    return false;
  }
}

/** Whether this browser holds a push subscription now (permission still granted). False when it cannot be asked. */
export async function thisBrowserSubscribed(): Promise<boolean> {
  try {
    return pushSupported() && Notification.permission === "granted" && (await existingSubscription()) !== null;
  } catch {
    return false;
  }
}

/**
 * Signed out: turn on game alerts here, from a tap (the permission prompt needs one). Asks permission only when it is not already
 * granted, subscribes, and tells the database this browser follows `list` (the programs it already follows; the list stays as it
 * is). Throws "permission" when blocked, "nothing followed" when the list is empty (a subscription needs a program to be kept).
 */
export async function subscribeHere(list: string[]): Promise<void> {
  if (!list.length) throw new Error("nothing followed");
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error("permission");
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = subscription.toJSON();
  await rpc("push_follow", { p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_programs: list });
  remember(list);
}

/** Signed out: stop every alert on this browser (the database forgets it, the subscription is dropped) but keep its list of followed programs, so alerts can come back on with one tap. */
export async function stopHere(): Promise<void> {
  const subscription = await existingSubscription();
  if (!subscription) return;
  await rpc("push_unfollow", { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/**
 * Signed in: link this browser's push subscription to the account, so the account's follows drive its alerts. The browser's
 * own follows move onto the account, and what does not fit stays in this browser's list (the server answers with it).
 * With `subscribe`, a browser that has no subscription asks permission and makes one (call it from the tap that follows a
 * program); without, only an existing one is linked. false: there was nothing to link. Throws "permission" when blocked.
 */
export async function linkToAccount(subscribe: boolean): Promise<boolean> {
  let subscription = await existingSubscription();
  if (!subscription) {
    if (!subscribe) return false;
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error("permission");
    const registration = await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  }
  const json = subscription.toJSON();
  const res = await fetch("/api/push/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
  });
  if (!res.ok) throw new Error(`link: ${res.status}`);
  remember(((await res.json()) as { programs: string[] }).programs);
  return true;
}

/** Follow (on) or stop following (off) one program; returns the programs followed afterwards. */
export async function setFollow(slug: string, on: boolean): Promise<string[]> {
  const list = on ? [...new Set([...followedHere(), slug])].sort() : followedHere().filter((s) => s !== slug);
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!list.length) {
    if (subscription) {
      await rpc("push_unfollow", { p_endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
  } else {
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
      throw new Error("permission");
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    const json = subscription.toJSON();
    await rpc("push_follow", { p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_programs: list });
  }
  remember(list);
  return list;
}
