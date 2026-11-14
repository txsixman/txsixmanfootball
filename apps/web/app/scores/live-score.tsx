"use client";

import { useEffect, useState } from "react";
import { checkedAt, fetchLiveRows, type LiveRow, type LiveView } from "@/lib/live-scores";

// Live scores during a game (ADR 0021). The pages are static; this reads the score of games under way through the public
// function live_scores() in the browser, every minute while the tab is visible. It shows nothing when the request fails or
// no row matches. The score is the read's, so it says "Unconfirmed" and names no leader.
const REFRESH_MS = 60_000;

/** The live rows, refreshed every minute while the tab is visible. Empty until a read succeeds, and again when one fails.
 * `enabled` false (nothing on the page can be under way) asks for nothing. */
export function useLiveScores(enabled = true): LiveRow[] {
  const [rows, setRows] = useState<LiveRow[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pending: AbortController | undefined;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      pending?.abort();
      const mine = new AbortController();
      pending = mine;
      try {
        const next = await fetchLiveRows(mine.signal);
        if (!stopped && !mine.signal.aborted) setRows(next);
      } catch {
        if (!stopped && !mine.signal.aborted) setRows([]);
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      stopped = true;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);
  return rows;
}

/** "Live · Q3 · 28–14 · Unconfirmed" (scores in the order the page lists the teams), the teams with their scores, and when it was read. */
export function LiveLine({ live, className = "" }: { live: LiveView; className?: string }) {
  const scores = `${live.away.score}–${live.home.score}`;
  return (
    <div data-live-score className={`font-num ${className}`}>
      <p className="text-[15px] font-bold uppercase leading-5 tracking-wide text-red">
        {["Live", live.period, scores, "Unconfirmed"].filter(Boolean).join(" · ")}
      </p>
      <p className="font-sans text-[13px] leading-4 text-muted">
        {live.away.name} {live.away.score}, {live.home.name} {live.home.score} &middot; checked {checkedAt(live.readAt)}
      </p>
    </div>
  );
}
