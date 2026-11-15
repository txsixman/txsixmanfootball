"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveEmailAlerts, saveEmailDigest, type EmailAlertsState } from "./email-actions";

const titleCase = (slug: string) => slug.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");

/** The followed teams' names, from the same small per-program files My teams reads; a team whose file cannot be reached keeps its address-style name. */
function useTeamNames(slugs: string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const abort = new AbortController();
    for (const slug of slugs) {
      fetch(`/my-teams/${encodeURIComponent(slug)}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]) })
        .then((res) => (res.ok ? (res.json() as Promise<{ school?: string }>) : undefined))
        .then((team) => team?.school && setNames((was) => ({ ...was, [slug]: team.school! })))
        .catch(() => undefined);
    }
    return () => abort.abort();
  }, [slugs]);
  return (slug: string) => names[slug] ?? titleCase(slug);
}

/**
 * Email alerts for followed teams (ADR 0053): a kickoff, a final, and the next game once the bracket sets it. All off until the
 * fan saves a choice. "All the teams I follow" covers teams followed later too; otherwise each team is its own box. The weekly
 * digest (ADR 0055) is a separate choice with its own save: one box, for every team the fan follows.
 */
export function EmailAlertsForm({ eligible, follows, allFollowed, teams, digest }: { eligible: boolean; follows: string[]; allFollowed: boolean; teams: string[]; digest: boolean }) {
  const [state, action, pending] = useActionState<EmailAlertsState, FormData>(saveEmailAlerts, {});
  const [all, setAll] = useState(allFollowed);
  const [picked, setPicked] = useState<string[]>(teams);
  const name = useTeamNames(follows);
  return (
    <section aria-labelledby="email-alerts" className="mt-8 max-w-prose">
      <h2 id="email-alerts" className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">Email alerts</h2>
      {!eligible ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Email alerts are not available for this account.</p>
      ) : !follows.length ? (
        <p className="mt-1 max-w-sm text-[14px] text-muted">Follow a team from its page first, then you can turn on its emails here.</p>
      ) : (
        <>
        <form action={action} className="mt-1 flex max-w-sm flex-col gap-2">
          <p className="text-[14px] text-muted">An email when a team you follow kicks off, finishes, or has its next game set. Off until you turn it on. Every email has an unsubscribe link.</p>
          <fieldset className="flex flex-col">
            <legend className="sr-only">Teams to email you about</legend>
            <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold text-ink">
              <input type="checkbox" name="all" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-5" />
              All the teams I follow
            </label>
            {follows.map((slug) => (
              <label key={slug} className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                <input
                  type="checkbox"
                  name="team"
                  value={slug}
                  checked={all || picked.includes(slug)}
                  disabled={all}
                  onChange={(e) => setPicked((was) => (e.target.checked ? [...was, slug] : was.filter((s) => s !== slug)))}
                  className="size-5"
                />
                {name(slug)}
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save email alerts"}</Button>
          </div>
          <div role="status">
            {state.saved && <p className="text-[14px] font-semibold text-ink">Saved.</p>}
            {state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}
          </div>
        </form>
        <WeeklyDigest on={digest} />
        </>
      )}
    </section>
  );
}

/** The weekly digest: one email on Mondays about every team the fan follows. Off until they save it. */
function WeeklyDigest({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<EmailAlertsState, FormData>(saveEmailDigest, {});
  const [checked, setChecked] = useState(on);
  return (
    <form action={action} aria-labelledby="email-digest" className="mt-6 flex max-w-sm flex-col gap-2">
      <h3 id="email-digest" className="font-num text-[16px] font-bold uppercase tracking-wider text-navy">Weekly digest</h3>
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
