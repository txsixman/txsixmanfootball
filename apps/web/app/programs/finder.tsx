"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Identity } from "@/lib/identity";
import { ORGS } from "@/lib/orgs";
import { CrestSlot, EmptyState, SectionBar } from "../ui";

export type FinderGroup = {
  /** The organization's `ORGS` slug. */
  org: string;
  heading: string;
  place: string;
  key: string;
  schools: { slug: string; school: string; identity: Identity }[];
};

/** Every program, one block per organization (ADR 0012), then division and district, with a box that narrows the list
 * as you type a school's name. A school listed by two organizations shows once under each. */
export function Finder({ groups }: { groups: FinderGroup[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, schools: q ? g.schools.filter((s) => s.school.toLowerCase().includes(q)) : g.schools }))
    .filter((g) => g.schools.length);
  const count = shown.reduce((n, g) => n + g.schools.length, 0);
  const orgs = ORGS.map((org) => {
    const inOrg = shown.filter((g) => g.org === org.slug);
    return { org, groups: inOrg, count: inOrg.reduce((n, g) => n + g.schools.length, 0) };
  }).filter((o) => o.count);

  return (
    <>
      <label className="mt-4 flex h-12 max-w-xl items-center gap-2.5 border-2 border-navy bg-page px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy">
        <Search aria-hidden="true" className="size-5 shrink-0 text-navy" />
        <span className="sr-only">Find a school</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a school"
          className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted"
        />
      </label>
      <p role="status" className="mt-2 text-[13px] text-muted">
        {q ? `${count} ${count === 1 ? "school matches" : "schools match"}` : `${count} programs`}
      </p>
      {orgs.length > 1 && (
        // Sticky, so a long list can be left for another organization from anywhere on the page.
        <nav aria-label="Jump to an organization" className="sticky top-0 z-10 mt-1 flex border-b-2 border-navy bg-page">
          {orgs.map(({ org, count: n }) => (
            <a
              key={org.slug}
              href={`#org-${org.slug}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel"
            >
              {org.label} <span className="text-[13px] font-semibold text-muted">{n}</span>
            </a>
          ))}
        </nav>
      )}
      {orgs.map(({ org, groups: inOrg, count: n }) => {
        // "UIL Division I" becomes "Division I" under the UIL heading; TCAF has no division, so no sub-heading.
        const divisions = [...new Set(inOrg.map((g) => g.heading))];
        return (
          <section key={org.slug} id={`org-${org.slug}`} aria-labelledby={`org-${org.slug}-h`} className="mt-8 scroll-mt-14">
            <SectionBar id={`org-${org.slug}-h`} title={org.label} aside={`${n} ${n === 1 ? "program" : "programs"}`} className="" />
            {divisions.map((division) => {
              const sub = division.slice(org.league.length).trim();
              const H = sub ? "h4" : "h3";
              return (
                <div key={division} className="mt-4">
                  {sub && <h3 className="section-title">{sub}</h3>}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {inOrg
                      .filter((g) => g.heading === division)
                      .map((g) => (
                        <article key={g.key} className="border border-line bg-panel">
                          <H className="border-b border-line bg-page px-3 py-2 font-num text-[15px] font-bold uppercase tracking-wider text-navy">{g.place}</H>
                          <ul>
                            {g.schools.map((s) => (
                              <li key={s.slug} className="border-b border-line last:border-b-0">
                                <Link href={`/programs/${s.slug}`} className="flex min-h-12 items-center px-3 text-[16px] leading-tight text-ink hover:bg-page hover:text-navy hover:underline">
                                  <CrestSlot school={s.school} identity={s.identity} size={28} />
                                  <span className="min-w-0">{s.school}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {!count && <EmptyState>No school matches &ldquo;{query.trim()}&rdquo;.</EmptyState>}
    </>
  );
}
