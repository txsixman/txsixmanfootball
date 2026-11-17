"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveBlocked } from "@/lib/saved-copy-state";
import { checkedLine, fetchReadAt, gameDay, type DayGame } from "@/lib/scores-checked";

// "Scores checked 4 min ago" (ADR 0038). Asks the public function results_read_at() on load and every minute while the tab is
// visible, but only once today's games have started: on any other day, before kickoff or while hidden it asks for nothing.
// A failed request or a bad answer shows nothing, never an error.
const REFRESH_MS = 60_000;

export function ScoresChecked({ games, className = "" }: { games: DayGame[]; className?: string }) {
  const latest = useRef(games);
  useEffect(() => {
    latest.current = games;
  });
  const [view, setView] = useState<{ now: number; readAt: number | null } | null>(null);
  // Nothing is asked of a saved copy or an offline phone (ADR 0096), and a read from before is not shown as current.
  const blocked = useLiveBlocked();
  useEffect(() => {
    if (blocked) return;
    let stopped = false;
    let pending: AbortController | undefined;
    const load = async () => {
      const now = Date.now();
      // The clock moves the minutes on even when nothing is asked.
      setView((v) => v && { ...v, now });
      if (document.visibilityState !== "visible" || !gameDay(latest.current, now)?.started) return;
      pending?.abort();
      const mine = new AbortController();
      pending = mine;
      try {
        const readAt = await fetchReadAt(mine.signal);
        if (!stopped && !mine.signal.aborted) setView({ now: Date.now(), readAt });
      } catch {
        if (!stopped && !mine.signal.aborted) setView(null);
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
  }, [blocked]);
  const day = !blocked && view && gameDay(games, view.now);
  const text = view && day ? checkedLine(day, view.readAt, view.now) : null;
  return text ? (
    <p data-scores-checked className={`text-[13px] leading-4 text-muted ${className}`}>
      {text}
    </p>
  ) : null;
}
