"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveEmailDigest, setAllTeamsEmail, type EmailAlertsState } from "./email-actions";
import type { EmailState } from "./email-state";

/**
 * The Email alerts block under Alerts and devices (ADR 0053, 0055, 0058). The per-team choices live in My teams (one "Email alerts"
 * box under each team); this is the rest: "All the teams I follow" (which also covers a team followed later) and the weekly digest.
 * All off until the fan turns one on. While EMAIL_ALERTS is off the block says so; an account that may not opt in is told so.
 */
export function EmailAlertsBlock({ email, hasFollows }: { email: EmailState; hasFollows: boolean }) {
  return (
    <section aria-labelledby="email-alerts" className="mt-6 max-w-prose">
      <h3 id="email-alerts" className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">Email alerts</h3>
      {email.status === "off" ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Email alerts aren&apos;t available yet.</p>
      ) : email.status === "error" ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Email alerts are not available right now. Try again in a minute.</p>
      ) : !email.eligible ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Email alerts are not available for this account.</p>
      ) : !hasFollows ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Follow a team from its page first, then you can turn on its emails here.</p>
      ) : (
        <>
          <AllTeams on={email.all} />
          <WeeklyDigest on={email.digest} />
        </>
      )}
    </section>
  );
}

/** "All the teams I follow": one choice for every team, now and later. Saves at once. Teams are picked one by one under My teams. */
function AllTeams({ on }: { on: boolean }) {
  const [all, setAll] = useState(on);
  const [seen, setSeen] = useState(on);
  if (seen !== on) {
    setSeen(on);
    setAll(on);
  }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function change(next: boolean) {
    setBusy(true);
    setNote("");
    setAll(next);
    const result = await setAllTeamsEmail(next).catch(() => ({ error: "That did not work. Check your connection and try again." }));
    if (result.error) {
      setAll(!next);
      setNote(result.error);
    } else setNote(next ? "Email alerts are on for every team you follow." : "Email alerts for every team are off. Choose teams one by one under My teams.");
    setBusy(false);
  }

  return (
    <div className="mt-1 flex max-w-sm flex-col gap-2">
      <p className="text-[14px] text-muted">An email when a team you follow kicks off, finishes, or has its next game set. Off until you turn it on. Every email has an unsubscribe link. To choose teams one by one, use the Email alerts box under each team in My teams.</p>
      <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold text-ink">
        <input type="checkbox" checked={all} disabled={busy} onChange={(e) => void change(e.target.checked)} className="size-5" />
        All the teams I follow
      </label>
      <div role="status" className="min-h-5 text-[14px] font-semibold text-ink">{note}</div>
    </div>
  );
}

/** The weekly digest: one email on Mondays about every team the fan follows. Off until they save it. */
function WeeklyDigest({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<EmailAlertsState, FormData>(saveEmailDigest, {});
  const [checked, setChecked] = useState(on);
  return (
    <form action={action} aria-labelledby="email-digest" className="mt-6 flex max-w-sm flex-col gap-2">
      <h4 id="email-digest" className="font-num text-[16px] font-bold uppercase tracking-wider text-navy">Weekly digest</h4>
      <p className="text-[14px] text-muted">One email on Monday mornings: last week&rsquo;s result, the ranking move and the next game for each team you follow. Off until you turn it on. It has an unsubscribe link.</p>
      <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold text-ink">
        <input type="checkbox" name="digest" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="size-5" />
        Email me the weekly digest
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save weekly digest"}</Button>
      </div>
      <div role="status">
        {state.saved && <p className="text-[14px] font-semibold text-ink">Saved.</p>}
        {state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}
      </div>
    </form>
  );
}
