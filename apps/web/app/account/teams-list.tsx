"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { changeAccountFollows } from "@/lib/account/follows";
import type { MyTeam } from "@/lib/my-teams";
import { dropFromThisBrowser, linkToAccount, pushSupported } from "@/lib/push";
import { Crest } from "../programs/crest";
import { setTeamEmail } from "./email-actions";
import { setTeamMuted, useThisBrowser } from "./this-browser";

/** What the list needs of the email state (app/account/email-state.ts). */
type TeamsEmail = { status: "off" } | { status: "error" } | { status: "ready"; eligible: boolean; all: boolean; teams: string[] };

type Info = Pick<MyTeam, "school" | "crest">;

const titleCase = (slug: string) => slug.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");

/** Known names and logos, kept for the visit: the same small per-program files My teams reads (a team whose file cannot be reached keeps its address-style name). */
const known = new Map<string, Info>();

function useTeamInfo(slugs: string[]) {
  const [, bump] = useState(0);
  const key = slugs.join(",");
  useEffect(() => {
    const abort = new AbortController();
    for (const slug of key ? key.split(",") : []) {
      if (known.has(slug)) continue;
      fetch(`/my-teams/${encodeURIComponent(slug)}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]) })
        .then((res) => (res.ok ? (res.json() as Promise<Info>) : undefined))
        .then((team) => {
          if (!team?.school) return;
          known.set(slug, { school: team.school, crest: team.crest });
          bump((n) => n + 1);
        })
        .catch(() => undefined);
    }
    return () => abort.abort();
  }, [key]);
  return (slug: string) => known.get(slug);
}

const BAD = "That did not work. Check your connection and try again.";

/**
 * My teams (ADR 0058): each followed team with its logo, a link to its page and Unfollow, then, per team, the alerts this account can
 * have for it. "Push alerts on this browser" shows only when this browser's subscription is linked to the account (it mutes one team
 * on this browser alone); "Email alerts" saves at once (email_set_optins through the server action). Every change is announced in the
 * one status line under the list.
 */
export function TeamsList({ slugs, email }: { slugs: string[]; email: TeamsEmail }) {
  const router = useRouter();
  const browser = useThisBrowser();
  const info = useTeamInfo(slugs);
  const [gone, setGone] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // The email choices the fan just made, until the page's own copy catches up. Dropped whenever the server's copy changes.
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const emailKey = email.status === "ready" ? `${email.all}|${email.teams.join(",")}` : email.status;
  const [seen, setSeen] = useState(emailKey);
  if (seen !== emailKey) {
    setSeen(emailKey);
    setPicks({});
  }

  const shown = slugs.filter((s) => !gone.includes(s));
  const name = (slug: string) => info(slug)?.school ?? titleCase(slug);

  async function unfollow(slug: string) {
    setBusy(slug);
    setNote("");
    try {
      // As the Follow button does: this browser's own follows move onto the account first, so a stale list cannot bring the team back.
      if (pushSupported()) await linkToAccount(false);
      await changeAccountFollows({ op: "unfollow", slug });
    } catch {
      setNote(BAD);
      setBusy(null);
      return;
    }
    dropFromThisBrowser(slug);
    setGone((was) => [...was, slug]);
    setNote(`Unfollowed ${name(slug)}.`);
    setBusy(null);
    router.refresh();
  }

  async function togglePush(slug: string, on: boolean) {
    setNote("");
    const saved = await setTeamMuted(slug, !on);
    setNote(saved ? `Push alerts ${on ? "on" : "off"} for ${name(slug)} on this browser.` : BAD);
  }

  async function toggleEmail(slug: string, on: boolean) {
    setBusy(slug);
    setNote("");
    setPicks((was) => ({ ...was, [slug]: on }));
    const result = await setTeamEmail(slug, on).catch(() => ({ error: BAD }));
    if (result.error) {
      setPicks((was) => {
        const rest = { ...was };
        delete rest[slug];
        return rest;
      });
      setNote(result.error);
    } else setNote(`Email alerts ${on ? "on" : "off"} for ${name(slug)}.`);
    setBusy(null);
  }

  if (!shown.length) {
    return (
      <p className="mt-2 max-w-sm text-[14px] text-muted">
        You are not following any teams yet. Follow one from its page, or{" "}
        <Link href="/programs" className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">browse the programs</Link>.
      </p>
    );
  }
  const emailReady = email.status === "ready" && email.eligible;
  return (
    <div className="mt-2">
      <ul>
        {shown.map((slug) => {
          const team = info(slug);
          const label = name(slug);
          const emailChecked = email.status === "ready" && (email.all || (picks[slug] ?? email.teams.includes(slug)));
          return (
            <li key={slug} className="border-b border-line py-1">
              <div className="flex items-center gap-2">
                {team && <Crest school={team.school} identity={team.crest} size={28} decorative />}
                <Link href={`/programs/${slug}`} prefetch={false} className="flex min-h-11 min-w-0 flex-1 items-center text-ink hover:text-navy hover:underline">
                  <span className="truncate font-num text-[20px] font-bold uppercase tracking-wide">{label}</span>
                </Link>
                <Button type="button" variant="outline" onClick={() => unfollow(slug)} disabled={busy === slug}>
                  Unfollow<span className="sr-only"> {label}</span>
                </Button>
              </div>
              {browser.status === "on" && (
                <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                  <input type="checkbox" className="size-5" checked={!browser.muted.includes(slug)} onChange={(e) => void togglePush(slug, e.target.checked)} />
                  <span>
                    Push alerts on this browser<span className="sr-only"> for {label}</span>
                  </span>
                </label>
              )}
              {(emailReady || email.status === "off") && (
                <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={emailChecked}
                    disabled={email.status === "off" || (email.status === "ready" && email.all) || busy === slug}
                    aria-describedby="email-teams-note"
                    onChange={(e) => void toggleEmail(slug, e.target.checked)}
                  />
                  <span>
                    Email alerts<span className="sr-only"> for {label}</span>
                  </span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <p id="email-teams-note" className="mt-2 max-w-sm text-[13px] leading-5 text-muted">
        {email.status === "off" && "Email alerts aren't available yet."}
        {email.status === "error" && "Email alerts are not available right now. Try again in a minute."}
        {email.status === "ready" && !email.eligible && "Email alerts are not available for this account."}
        {emailReady && email.all && (
          <>
            Email alerts are on for every team you follow. <a href="#alerts" className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Change that under Alerts and devices</a>.
          </>
        )}
        {emailReady && !email.all && "Email alerts: a kickoff, a final, and the next game once it is set. Each email has an unsubscribe link."}
      </p>
      <div role="status" className="min-h-5 text-[14px] font-semibold text-ink">{note}</div>
    </div>
  );
}
