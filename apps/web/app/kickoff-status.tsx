"use client";

import { useEffect, useState } from "react";
import { kickoffState, kickoffTime, type KickoffState } from "@/lib/kickoff";

// A game's kickoff status, worked out in the browser at the moment of viewing and again every minute (ADR 0036). The
// server's HTML holds what never changes (the kickoff time, or "Time not listed"), so the first render matches it and
// nothing depends on when the page was built.
const TICK_MS = 60_000;

/** The time now, refreshed every minute; null on the server and the first render in the browser. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const TONE: Record<KickoffState["kind"], string> = {
  starts: "text-ink",
  "in-progress": "bg-red px-1.5 text-white",
  awaiting: "text-ink",
  unlisted: "text-ink",
};

/** "Starts 7:00 PM CT", "In progress", "Score not reported yet" or "Time not listed"; `short` for a narrow cell. */
/** `tone` false: plain text, for a line already on a colored band. */
export function KickoffStatus({ date, kickoff, short = false, tone = true, className = "" }: { date: string; kickoff?: string; short?: boolean; tone?: boolean; className?: string }) {
  const now = useNow();
  const state = now ? kickoffState({ date, kickoff }, now) : null;
  const text = state ? (short ? state.short : state.label) : kickoff ? kickoffTime(kickoff) : "Time not listed";
  return (
    <span data-kickoff-status={state?.kind ?? "pending"} className={`${tone ? (state ? TONE[state.kind] : "text-ink") : ""} ${className}`}>
      {text}
    </span>
  );
}
