"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { fetchMe, signedInHint } from "@/lib/account/follows";
import { followedHere } from "@/lib/push";
import type { MyTeam } from "@/lib/my-teams";

// The section itself (its alerts switch, live scores and the crests) is its own chunk, fetched only when this browser follows
// a program the site knows: most visitors follow none and never load it (about 8 KB sent, ADR 0100).
const MyTeamsView = dynamic(() => import("./view"), { ssr: false });

/**
 * "My teams": each program this browser follows, with its record, last result and next game. The follow list is the account's when signed in
 * (/api/me), else this browser's (lib/push.ts), so this asks, after load, for the small per-program files built with the site
 * (app/my-teams/[slug]). It shows nothing at all when the visitor follows no one or the files cannot be reached.
 */
export function MyTeams() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [found, setFound] = useState<Record<string, MyTeam>>({});

  useEffect(() => {
    const abort = new AbortController();
    const load = (followed: string[]) => {
      setSlugs(followed);
      // One request per program, each on its own: a program the site no longer knows, or a slow answer, holds back no other.
      for (const slug of followed) {
        fetch(`/my-teams/${encodeURIComponent(slug)}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]) })
          .then((res) => (res.ok ? (res.json() as Promise<MyTeam>) : undefined))
          .then((team) => team && setFound((was) => ({ ...was, [slug]: team })))
          .catch(() => undefined); // offline or stale: that program is simply not shown
      }
    };
    // Signed in, the account's follows win; otherwise this browser's. A browser that last saw a signed-in fan waits for the
    // answer rather than flash its own list first; everyone else sees their list at once and is switched only if signed in.
    const waits = signedInHint();
    if (!waits) load(followedHere());
    void fetchMe().then((answer) => {
      const me = answer?.me;
      if (abort.signal.aborted) return;
      if (me && me.displayName !== null) load(me.follows);
      else if (waits) load(followedHere());
    });
    return () => abort.abort();
  }, []);

  const teams = slugs.flatMap((slug) => (found[slug] ? [found[slug]] : []));
  if (!teams.length) return null;
  return <MyTeamsView teams={teams} />;
}
