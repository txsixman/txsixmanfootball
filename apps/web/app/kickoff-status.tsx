"use client";

import { useEffect, useMemo, useState } from "react";
import { kickoffState, kickoffTime, type KickoffState } from "@/lib/kickoff";
import { useSavedCopy } from "@/lib/saved-copy-state";

// A game's kickoff status, worked out in the browser at the moment of viewing and again every minute (ADR 0036). The
// server's HTML holds what never changes (the kickoff time, or "Time not listed"), so the first render matches it and
// nothing depends on when the page was built.
const TICK_MS = 60_000;

/** The time now, refreshed every minute; null on the server and the first render in the browser. A saved copy (the service
 * worker's, ADR 0096) is read as of when it was saved, so it never says a game is "In progress" that it only knew as scheduled. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  const saved = useSavedCopy();
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const frozen = useMemo(() => (saved ? new Date(saved.savedAt) : null), [saved]);
  return frozen && now ? frozen : now;
}

const TONE: Record<KickoffState["kind"], string> = {
  starts: "text-ink",
  "in-progress": "bg-alert px-1.5 text-white",
  awaiting: "text-ink",
  unlisted: "text-ink",
};

/** "Starts 7:00 PM CT", "In progress", "Score not reported yet" or "Time not listed"; `short` for a narrow cell. */
/** `tone` false: plain text, for a line already on a colored band. */
export function KickoffStatus({ date, kickoff, short = false, tone = true, className = "" }: { date: string; kickoff?: string; short?: boolean; tone?: boolean; className?: string }) {
  const now = useNow();
  const saved = useSavedCopy();
  const state = now ? kickoffState({ date, kickoff }, now) : null;
  // A saved copy never says a game is on now: that was so when it was saved (ADR 0096).
  const text = state ? (saved && state.kind === "in-progress" ? (short ? "Under way" : "Under way when saved") : short ? state.short : state.label) : kickoff ? kickoffTime(kickoff) : "Time not listed";
  return (
    <span data-kickoff-status={state?.kind ?? "pending"} className={`${tone ? (state ? TONE[state.kind] : "text-ink") : ""} ${className}`}>
      {text}
    </span>
  );
}
