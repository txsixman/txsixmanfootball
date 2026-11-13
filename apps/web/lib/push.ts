// Browser push alerts for a followed program's finals (migration 0008, tools/push/send-finals.mjs). Public values only:
// the VAPID public key (its private half is a secret in the owner's Keychain and the repo's VAPID_PRIVATE_KEY), and
// Supabase's URL and publishable key (lib/supabase-public.ts), which by design can do nothing here but call push_follow and
// push_unfollow.
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
