import Link from "next/link";
import { standingsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgHref } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { type DistrictStandings, districtId, loadStandings, wl } from "@/lib/standings";
import { TabNav } from "../tab-nav";
import { CrestSlot, PageHeader, SectionBar } from "../ui";

const SEASON = CURRENT_SEASON;

/** The organizations with districts to rank: Independent has none, so it has no standings page and no tab. */
const ORGS_WITH_STANDINGS = ORGS.filter((o) => o.standings);

/** One page per organization (ADR 0012); UIL splits into its two divisions, the others are one page each. */
export const GROUPS = [
  { slug: "", org: ORGS[0], label: "Division I", test: (d: DistrictStandings) => d.league === "UIL" && d.division === "I" },
  { slug: "division-2", org: ORGS[0], label: "Division II", test: (d: DistrictStandings) => d.league === "UIL" && d.division === "II" },
  ...ORGS_WITH_STANDINGS.slice(1).map((org) => ({ slug: org.slug, org, label: org.label, test: (d: DistrictStandings) => d.league === org.league })),
];

export type Group = (typeof GROUPS)[number];
const hrefOf = (g: Group) => (g.slug ? `/standings/${g.slug}` : "/standings");
const uilDivisions = GROUPS.filter((g) => g.org === ORGS[0]);

function District({ d, identities }: { d: DistrictStandings; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  const id = districtId(d.key);
  return (
    <section aria-labelledby={id} className="mt-6">
      <SectionBar id={id} title={d.title} className="" />
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">{d.title} standings</caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="py-1.5 pl-3 text-left font-semibold">Team</th>
            {d.districtPlay && <th scope="col" className="w-[3.75rem] py-1.5 text-right font-semibold">District</th>}
            <th scope="col" className="w-[3.75rem] py-1.5 text-right font-semibold">Overall</th>
            <th scope="col" className="w-14 py-1.5 pr-3 text-right font-semibold">
              <span aria-hidden="true">+/−</span>
              <span className="sr-only">Point difference</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.school.slug} className="border-t border-line">
              <th scope="row" className="pl-3 text-left font-normal">
                <Link href={`/programs/${r.school.slug}`} className="flex min-h-11 items-center text-ink hover:text-navy hover:underline">
                  <CrestSlot school={r.school.school} identity={identities.get(r.school.slug) ?? EMPTY} />
                  {r.school.school}
                </Link>
              </th>
              {d.districtPlay && <td className="text-right font-num text-[18px] font-bold tabular-nums text-navy">{wl(r.district)}</td>}
              <td className={`text-right font-num tabular-nums ${d.districtPlay ? "text-[17px]" : "text-[18px] font-bold text-navy"}`}>{wl(r.overall)}</td>
              <td className="pr-3 text-right font-num text-[15px] tabular-nums text-muted">
                {r.pointsFor - r.pointsAgainst > 0 ? "+" : ""}
                {r.pointsFor - r.pointsAgainst}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The meta description of one standings page. */
export async function describeStandings(group: Group) {
  const districts = (await loadStandings(CURRENT_SEASON, { conferences: true })).filter(group.test);
  return standingsDescription({
    label: group.org === ORGS[0] ? `UIL ${group.label}` : group.label,
    season: CURRENT_SEASON,
    teams: districts.reduce((n, d) => n + d.rows.length, 0),
    groups: districts.length,
    districtPlay: districts.every((d) => d.districtPlay),
  });
}

export async function StandingsView({ group }: { group: Group }) {
  const [all, identities] = await Promise.all([loadStandings(SEASON, { conferences: true }), loadIdentities()]);
  const districts = all.filter(group.test);
  const districtPlay = districts.every((d) => d.districtPlay);
  return (
    <section aria-labelledby="standings">
      <PageHeader
        id="standings"
        eyebrow={`${SEASON} season · ${group.org === ORGS[0] ? `UIL ${group.label}` : group.label}`}
        title="Standings"
        note={
          districtPlay
            ? `${districts.length} districts. District records count regular-season games only; overall records include playoff games. Ordered by district record, then overall; league tiebreakers are not applied. Scores are not confirmed here and may change.`
            : `${districts.length} groups. ${group.org.label} has no districts, so teams are grouped by division and region and ordered by overall record. Scores are not confirmed here and may change.`
        }
      />
      {/* Organization tabs first; UIL has a second row for its two divisions (four tabs fit a phone, five would not). */}
      <TabNav
        label="Standings by organization"
        tabs={ORGS_WITH_STANDINGS.map((o) => ({ href: orgHref("/standings", o), label: o.label }))}
        current={orgHref("/standings", group.org)}
      />
      {group.org === ORGS[0] && (
        <TabNav label="UIL standings by division" tabs={uilDivisions.map((g) => ({ href: hrefOf(g), label: g.label }))} current={hrefOf(group)} />
      )}
      {districts.map((d) => (
        <District key={d.key} d={d} identities={identities} />
      ))}
    </section>
  );
}
