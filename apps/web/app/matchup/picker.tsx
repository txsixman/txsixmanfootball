"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Identity } from "@/lib/identity";
import { project, projectionParts } from "@/lib/projection";
import { signed } from "@/lib/signed";
import { type Meeting, pairKey } from "@/lib/meetings";
import type { RatingsTable } from "@/lib/ratings";
import { Crest } from "../programs/crest";

export type MatchupTeam = { slug: string; name: string; group: string; rating: number; record: string; identity: Identity };

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Two teams, a site, and the projected margin and win probability between them. The choice stays in the URL. */
export function Matchup({ teams, table, meetings }: { teams: MatchupTeam[]; table: RatingsTable; meetings: Record<string, Meeting[]> }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [site, setSite] = useState<"neutral" | "a" | "b">("neutral");
  // The URL is written only after it has been read, or the first write would erase a shared link's choice.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const known = (s: string | null) => (s && teams.some((t) => t.slug === s) ? s : "");
    setA(known(q.get("a")));
    setB(known(q.get("b")));
    const at = q.get("at");
    if (at === "a" || at === "b") setSite(at);
    setReady(true);
  }, [teams]);
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams();
    if (a) q.set("a", a);
    if (b) q.set("b", b);
    if (site !== "neutral") q.set("at", site);
    window.history.replaceState(null, "", q.size ? `?${q}` : window.location.pathname);
  }, [ready, a, b, site]);

  const groups = [...new Set(teams.map((t) => t.group))];
  const ta = teams.find((t) => t.slug === a);
  const tb = teams.find((t) => t.slug === b);
  // Home team first for project(); a neutral site has no home edge either way.
  const p = ta && tb && ta.slug !== tb.slug
    ? site === "b" ? project(table, tb.name, ta.name, false) : project(table, ta.name, tb.name, site === "neutral", true)
    : undefined;
  const met = p ? (meetings[pairKey(ta!.slug, tb!.slug)] ?? []) : [];
  // Team 1's share of the win probability, for the bar under the projection (the text carries the same number).
  const share1 = p ? (p.favorite === ta!.name ? p.winProbability : 1 - p.winProbability) : 0.5;

  const select = (label: string, value: string, set: (v: string) => void) => (
    <label className="block">
      <span className="font-num text-[14px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} className="mt-1 block h-12 w-full border-2 border-navy bg-page px-2 text-[16px] text-ink">
        <option value="">Choose a team</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {teams.filter((t) => t.group === g).map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );

  const sites = [["neutral", "Neutral site"], ["a", ta ? `At ${ta.name}` : "At team 1"], ["b", tb ? `At ${tb.name}` : "At team 2"]] as const;

  return (
    <div className="mt-5 lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {select("Team 1", a, setA)}
          {select("Team 2", b, setB)}
        </div>
        <fieldset className="mt-4">
          <legend className="font-num text-[14px] font-bold uppercase tracking-wider text-muted">Where</legend>
          {/* A segmented control: each radio is stretched invisibly over its label, so the whole segment is the tap target. */}
          <div className="mt-1 grid grid-cols-3 border-2 border-navy">
            {sites.map(([v, label]) => (
              <label
                key={v}
                className={`relative flex min-h-12 items-center justify-center px-1.5 py-1 text-center text-[14px] font-semibold leading-tight has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${
                  v === "neutral" ? "" : "border-l-2 border-navy"
                } ${site === v ? "bg-band text-white" : "bg-page text-navy"}`}
              >
                <input type="radio" name="site" value={v} checked={site === v} onChange={() => setSite(v)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <section aria-live="polite" aria-label="Projection" className="mt-5 border-2 border-navy bg-panel lg:mt-0">
        {p ? (
          <>
            <dl className="grid grid-cols-2 border-b-2 border-navy bg-page">
              {[ta!, tb!].map((t, i) => (
                <div key={t.slug} className={`min-w-0 px-3 py-3 ${i ? "border-l border-line" : ""}`}>
                  <dt>
                    <Link href={`/programs/${t.slug}`} className="flex min-h-11 items-center gap-2 font-num text-[20px] font-bold uppercase leading-tight text-navy hover:underline">
                      <Crest school={t.name} identity={t.identity} size={36} decorative />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{t.name}</span>
                    </Link>
                  </dt>
                  <dd className="mt-1 text-[14px] text-muted">Rating {signed(t.rating)} · {t.record}</dd>
                </div>
              ))}
            </dl>
            <div className="px-4 py-4">
              <p className="font-num text-[13px] font-bold uppercase tracking-widest text-red">Projected</p>
              <p className="mt-1 font-num text-[36px] font-bold uppercase leading-none text-navy">{projectionParts(p).margin}</p>
              <p className="mt-1 text-[17px] text-ink">{projectionParts(p).chance}</p>
              {/* Team 1 navy, team 2 red, as the squares in their names; the win probability in words is above. */}
              <div aria-hidden="true" className="mt-3 flex h-3 bg-alert">
                <span className="bg-band" style={{ width: `${Math.round(share1 * 100)}%` }} />
              </div>
              <div aria-hidden="true" className="mt-1.5 flex justify-between gap-3 text-[13px] text-muted">
                <span className="flex min-w-0 items-center gap-1.5"><span className="size-2.5 shrink-0 bg-band" /><span className="truncate">{ta!.name}</span></span>
                <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{tb!.name}</span><span className="size-2.5 shrink-0 bg-alert" /></span>
              </div>
            </div>
            <div className="border-t border-line px-4 pb-3 pt-3">
              <h2 className="font-num text-[13px] font-bold uppercase tracking-widest text-red">Last meetings</h2>
              {met.length ? (
                <>
                  <ul className="mt-1 text-[15px] text-ink">
                    {met.slice(0, 5).map(([date, home, hs, as, forfeit]) => {
                      // Team 1 first. Sites are left out: the source marks no neutral sites, and playoff games mostly are.
                      const [first, second] = home === ta!.slug ? [hs, as] : [as, hs];
                      return (
                        <li key={date} className="border-t border-line py-1.5 first:border-t-0">
                          <span className="text-[14px] text-muted">{longDate(date)}</span>
                          <span className="block font-num text-[18px] font-bold tabular-nums">
                            {forfeit ? "Forfeit" : `${ta!.name} ${first}, ${tb!.name} ${second}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[13px] text-muted">Scores are not confirmed here.</p>
                </>
              ) : (
                <p className="mt-1 text-[15px] text-muted">No games between them in the seasons on this site.</p>
              )}
            </div>
          </>
        ) : (
          <p className="px-4 py-6 text-center text-[15px] text-muted">
            {ta && tb && ta.slug === tb.slug ? "Choose two different teams." : "Choose two teams to see a projection."}
          </p>
        )}
      </section>
    </div>
  );
}
