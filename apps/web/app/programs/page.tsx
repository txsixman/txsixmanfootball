import type { Metadata } from "next";
import { byDistrict, loadAlignments, placeLabel, uniquePrograms } from "@/lib/alignments";
import { programsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { loadNotListed } from "@/lib/not-listed";
import { ORGS, orgByLeague } from "@/lib/orgs";
import { PageHeader, SectionBar } from "../ui";
import { districtPages } from "../standings/view";
import { Finder } from "./finder";
import { programsTitle } from "@/lib/titles";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  const programs = uniquePrograms(await loadAlignments()).length;
  return { title: programsTitle(), description: programsDescription(programs, ORGS.map((o) => o.label)), alternates: { canonical: "/programs" } };
}

export default async function Programs() {
  const [alignments, identities, districts, notListed] = await Promise.all([loadAlignments(), loadIdentities(), districtPages(), loadNotListed()]);
  const districtHrefs = new Map(districts.map((p) => [p.d.key, p.href]));
  const groups = byDistrict(alignments).map((g) => ({
    org: orgByLeague(g.schools[0].league)!.slug,
    heading: g.heading,
    place: placeLabel(g),
    key: `${g.heading}|${g.district}`,
    href: districtHrefs.get(`${g.heading}|${g.district}`),
    schools: g.schools.map((s) => ({ slug: s.slug, school: s.school, identity: identities.get(s.slug) ?? EMPTY })),
  }));

  return (
    <>
      <PageHeader eyebrow={ORGS.map((o) => o.label).join(" · ")} title="Programs" />
      <Finder groups={groups} />
      {notListed.length > 0 && <NotListed leagues={notListed} />}
    </>
  );
}

/** The programs the registry knows it is missing (ADR 0073), by league: counted, never ranked and with no program page,
 * so a gap shows as a gap rather than as a guess. */
function NotListed({ leagues }: { leagues: Awaited<ReturnType<typeof loadNotListed>> }) {
  const teams = leagues.reduce((n, l) => n + l.schools.length, 0);
  return (
    <section aria-labelledby="not-listed-h" className="mt-10">
      <SectionBar id="not-listed-h" title="Not yet listed" aside={teams ? `${teams} ${teams === 1 ? "team" : "teams"}` : `${leagues.length} ${leagues.length === 1 ? "league" : "leagues"}`} className="" />
      <p className="mt-3 max-w-prose text-[15px] text-ink">
        Leagues and teams we have checked but cannot list yet, because no public page names their six-man teams. Each moves into
        the list above once one does.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((l) => (
          <article key={l.league} className="border border-line bg-panel">
            <h3 className="border-b border-line bg-page px-3 py-2 font-num text-[15px] font-bold uppercase tracking-wider text-navy">
              {l.league} <span className="text-[13px] font-semibold text-muted">{l.schools.length ? l.schools.length : ""}</span>
            </h3>
            {l.reasons.map((r) => (
              <p key={r} className="px-3 pt-2 text-[14px] text-muted">
                {r}
              </p>
            ))}
            {l.schools.length > 0 && (
              <ul className="mt-2">
                {l.schools.map((s) => (
                  <li key={s} className="flex min-h-11 items-center border-t border-line px-3 text-[16px] leading-tight text-ink">
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {!l.schools.length && <p className="px-3 pb-2 text-[14px] text-muted">No team known yet.</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
