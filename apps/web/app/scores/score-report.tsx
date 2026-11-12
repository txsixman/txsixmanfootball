"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { send, useMe } from "../posts/client";
import { WhyNotForm, canPost } from "../posts/post-parts";

// Fans' score reports for a game with no score yet. Nothing a fan reports shows on its own: the page says how many
// reports came in (never what they said), and shows a score only once the database confirms it: two accounts older than
// 7 days agree, or it matches the score read for the game (fan_score_status, migration 0014). Even then no winner is named
// and it is not a final result (ADR 0004).
type Status = { reports: number; confirmed: boolean; homeScore?: number; awayScore?: number; basis?: string };

/** Today's date in Texas, "2026-11-13": reports open on the game's day. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

export function ScoreReport({ gameKey, away, home, date }: { gameKey: string; away: string; home: string; date?: string }) {
  const pathname = usePathname();
  const me = useMe();
  const [status, setStatus] = useState<Status | null>(null);
  const [awayScore, setAwayScore] = useState("");
  const [homeScore, setHomeScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/games/${encodeURIComponent(gameKey)}/score-report`);
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      // Without the count the block still works: it just shows no number.
    }
  }, [gameKey]);
  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const r = await send("POST", "/api/fan/reports", { gameKey, home: Number(homeScore), away: Number(awayScore) });
    setBusy(false);
    if (r.ok) {
      setNote("Thank you. Your report was received.");
      setAwayScore("");
      setHomeScore("");
      load();
    } else setNote(r.message);
  }

  const open = !date || today() >= date;
  return (
    <section aria-labelledby="fan-report" className="mt-5 px-3">
      <h2 id="fan-report" className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        Fan score reports
      </h2>
      {status?.confirmed && status.homeScore != null && status.awayScore != null ? (
        <p className="pt-2 text-[15px] leading-5 text-ink">
          <b>Fans report {away} {status.awayScore}, {home} {status.homeScore}.</b>{" "}
          {status.basis === "results_watch" ? "That matches the score read for this game." : "Two fan accounts agree."} Not a final result, and no winner is named.
        </p>
      ) : (
        <p className="pt-2 text-[15px] leading-5 text-ink">
          No score is confirmed yet.
          {status && status.reports > 0 ? ` ${status.reports} ${status.reports === 1 ? "report" : "reports"} received.` : ""}
        </p>
      )}
      <div className="pt-2">
        {canPost(me) && open && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-[14px] text-muted">Saw this game? Report the final score. It shows only after it is confirmed.</p>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="report-away">{away} score</Label>
                <Input id="report-away" type="number" inputMode="numeric" min={0} max={199} step={1} required value={awayScore} onChange={(e) => setAwayScore(e.target.value)} />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="report-home">{home} score</Label>
                <Input id="report-home" type="number" inputMode="numeric" min={0} max={199} step={1} required value={homeScore} onChange={(e) => setHomeScore(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={busy || awayScore === "" || homeScore === ""} className="self-start">
              {busy ? "Sending…" : "Report final score"}
            </Button>
          </form>
        )}
        {canPost(me) && !open && <p className="text-[14px] text-muted">Score reports open on the day of the game.</p>}
        <WhyNotForm me={me} next={pathname} what="report the final score" />
        <p role="status" aria-live="polite" className="min-h-5 pt-1 text-[14px] font-semibold text-red">{note}</p>
      </div>
    </section>
  );
}
