"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe, signedInHint } from "@/lib/account/follows";
import { followedHere } from "@/lib/push";
import type { MyGame, MyTeam } from "@/lib/my-teams";
import { Crest } from "../programs/crest";

/** One game line: "Last" or "Next", date, opponent, and the score or the projection. A playoff game links to its page. */
function Line({ label, game }: { label: string; game: MyGame }) {
  const body = (
    <>
      <span className="w-11 shrink-0 text-[13px] font-bold uppercase tracking-wider text-red">{label}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink">
        <span className="block">
          {game.status} · {game.home ? "vs" : "at"}{" "}
          {game.opponentSlug && !game.href ? (
            <Link href={`/programs/${game.opponentSlug}`} className="inline-flex min-h-11 items-center hover:text-navy hover:underline">
              {game.opponent}
            </Link>
          ) : (
            game.opponent
          )}
        </span>
        {game.note && <span className="block text-[13px] leading-4 text-muted">{game.note}</span>}
      </span>
      {game.score && <span className="shrink-0 font-num text-[20px] font-bold tabular-nums text-ink">{game.score}</span>}
    </>
  );
  const layout = "flex min-h-11 items-center gap-2 py-1";
  return game.href ? (
    <Link href={game.href} className={`${layout} hover:bg-panel`}>
      {body}
    </Link>
  ) : (
    <div className={layout}>{body}</div>
  );
}

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
  return (
    <section aria-labelledby="my-teams" data-pagefind-ignore className="mt-6">
      <h2 id="my-teams" className="section-title">My teams</h2>
      <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
        {teams.map((t) => (
          <li key={t.slug} className="border-b border-line pb-1">
            <Link href={`/programs/${t.slug}`} className="flex min-h-11 items-center gap-2 text-ink hover:text-navy hover:underline">
              <Crest school={t.school} identity={t.crest} size={28} decorative />
              <span className="min-w-0 flex-1 truncate font-num text-[20px] font-bold uppercase tracking-wide">{t.school}</span>
              {t.record && (
                <span className="font-num text-[20px] font-bold tabular-nums text-navy">
                  {t.record}
                  <span className="sr-only"> this season</span>
                </span>
              )}
            </Link>
            {t.last && <Line label="Last" game={t.last} />}
            {t.next && <Line label="Next" game={t.next} />}
            {!t.last && !t.next && <p className="py-1 text-[14px] text-muted">No games on record yet.</p>}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[13px] text-muted">Scores are not confirmed here.</p>
    </section>
  );
}
