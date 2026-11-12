"use client";

import { useEffect, useState } from "react";

// What the posting blocks (game comments, score reports, forums) share in the browser. Every call goes to this site's own
// /api routes: the session cookie is httpOnly and there is no Supabase client here.

export type Me =
  | { signedIn: false }
  | { signedIn: true; profile: false }
  | { signedIn: true; profile: true; displayName: string; established: boolean; canPost: boolean; muted: boolean; banned: boolean };

/** Who is signed in: undefined while asking, then the answer. A failed ask reads as signed out (read-only is the safe side). */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch("/api/fan/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : { signedIn: false as const }))
      .catch(() => ({ signedIn: false as const }))
      .then((m) => live && setMe(m));
    return () => {
      live = false;
    };
  }, []);
  return me;
}

export type Sent = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

/** A write: JSON in, the server's sentence out when it is refused. */
export async function send(method: "POST" | "PATCH", url: string, body: unknown = {}): Promise<Sent> {
  try {
    const r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) return { ok: true, data };
    return { ok: false, message: typeof data.message === "string" ? data.message : "Something went wrong. Try again in a minute." };
  } catch {
    return { ok: false, message: "Could not reach the site. Check your connection and try again." };
  }
}

/** "Nov 12, 2026, 7:05 PM" in Texas time. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
