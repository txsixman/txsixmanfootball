import Link from "next/link";
import { activeOrgs } from "@/lib/active-orgs";
import type { Final } from "@/lib/champions";
import { CURRENT_SEASON } from "@/lib/season";
import { loadWeeks } from "@/lib/weeks";
import { weekHref } from "./results/paths";
import { districtPages } from "./standings/view";

// The home page's link lists: every district's standings page, each organization's latest week of results and the latest
// State Championship years, so those pages (and the game and program pages they link to) are at most two clicks from /.
// Links only, no data: the home page stays light.

const YEARS = 10;
const linkClass = "inline-flex min-h-11 min-w-11 items-center justify-center font-num text-[16px] font-bold text-navy underline-offset-2 hover:underline";

export async function HomeBrowse({ finals }: { finals: Final[] }) {
  const [districts, orgs] = await Promise.all([districtPages(), activeOrgs()]);
  const weeks = await Promise.all(
    orgs.map(async (org) => ({ org, week: (await loadWeeks(CURRENT_SEASON, org)).findLast((w) => w.games.length)?.number })),
  );
  // One line per division ("TAPPS Division III"): a TAPPS standings page holds several, each numbered from 1.
  const groups = [...new Set(districts.map((p) => p.heading))].map((label) => ({ label, districts: districts.filter((p) => p.heading === label) }));
  const years = [...new Set(finals.map((f) => f.season))].sort((a, b) => b - a).slice(0, YEARS);

  return (
    <nav aria-labelledby="browse" className="mt-8">
      <h2 id="browse" className="section-title">Browse</h2>
      <div className="mt-2 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <section aria-labelledby="browse-districts">
          <h3 id="browse-districts" className="font-num text-[16px] font-bold uppercase tracking-wider text-ink">District standings</h3>
          {groups.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-x-1">
              <span className="mr-1 text-[14px] text-muted">{g.label}</span>
              {g.districts.map((p) => (
                <Link key={p.href} href={p.href} prefetch={false} className={linkClass}>
                  <span className="sr-only">{`${g.label} District `}</span>
                  {p.number}
                </Link>
              ))}
            </div>
          ))}
        </section>
        <div className="grid gap-y-4">
          <section aria-labelledby="browse-results">
            <h3 id="browse-results" className="font-num text-[16px] font-bold uppercase tracking-wider text-ink">Latest results</h3>
            <div className="flex flex-wrap gap-x-4">
              {weeks.map(({ org, week }) =>
                week ? (
                  <Link key={org.slug} href={weekHref(CURRENT_SEASON, week, org)} prefetch={false} className={linkClass}>
                    {`${org.label} week ${week}`}
                  </Link>
                ) : null,
              )}
            </div>
          </section>
          {years.length > 0 && (
            <section aria-labelledby="browse-titles">
              <h3 id="browse-titles" className="font-num text-[16px] font-bold uppercase tracking-wider text-ink">State Championships</h3>
              <div className="flex flex-wrap gap-x-3">
                {years.map((y) => (
                  <Link key={y} href={`/championships/${y}`} prefetch={false} className={linkClass}>
                    <span className="sr-only">State Championships </span>
                    {y}
                  </Link>
                ))}
                <Link href="/championships" prefetch={false} className={linkClass}>
                  Every year
                </Link>
              </div>
            </section>
          )}
        </div>
      </div>
    </nav>
  );
}
