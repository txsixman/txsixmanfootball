import Link from "next/link";
import type { ReactNode } from "react";
import { standingsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgHref } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { type DistrictStandings, districtId, loadStandings, wl } from "@/lib/standings";
import { type AreaGroup, districtLabel, type Level, levelsOf, type RankedRow, regionsOf } from "@/lib/standings-levels";
import { TabNav } from "../tab-nav";
import { CrestSlot, PageHeader, SectionBar } from "../ui";
import { LevelViews } from "./level-views";

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

type Identities = Awaited<ReturnType<typeof loadIdentities>>;

// prefetch={false}, as in the rankings table: each level repeats every team, and the sample page's invented schools
// have no program page, so a prefetch of each 404 kept the page from ever going quiet.
function TeamCell({ r, identities }: { r: RankedRow | DistrictStandings["rows"][number]; identities: Identities }) {
  return (
    <th scope="row" className="pl-3 text-left font-normal">
      <Link href={`/programs/${r.school.slug}`} prefetch={false} className="flex min-h-11 items-center text-ink hover:text-navy hover:underline">
        <CrestSlot school={r.school.school} identity={identities.get(r.school.slug) ?? EMPTY} />
        {r.school.school}
      </Link>
    </th>
  );
}

function PointDiff({ r }: { r: { pointsFor: number; pointsAgainst: number } }) {
  return (
    <td className="pr-3 text-right font-num text-[15px] tabular-nums text-muted">
      {r.pointsFor - r.pointsAgainst > 0 ? "+" : ""}
      {r.pointsFor - r.pointsAgainst}
    </td>
  );
}

const DiffHeader = () => (
  <th scope="col" className="w-14 py-1.5 pr-3 text-right font-semibold">
    <span aria-hidden="true">+/−</span>
    <span className="sr-only">Point difference</span>
  </th>
);

/** A district's table, ordered by district record (lib/standings.ts). `title` and `bar` let a level page name it in full. */
function District({ d, identities, title = d.title, bar }: { d: DistrictStandings; identities: Identities; title?: string; bar?: ReactNode }) {
  const caption = title === d.title ? title : `${leagueOf(d)} · ${title}`;
  const id = districtId(d.key);
  return (
    <section aria-labelledby={id} className="mt-6">
      {bar ?? <SectionBar id={id} title={title} className="" />}
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">{caption} standings</caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="py-1.5 pl-3 text-left font-semibold">Team</th>
            {d.districtPlay && <th scope="col" className="w-[3.75rem] py-1.5 text-right font-semibold">District</th>}
            <th scope="col" className="w-[3.75rem] py-1.5 text-right font-semibold">Overall</th>
            <DiffHeader />
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.school.slug} className="border-t border-line">
              <TeamCell r={r} identities={identities} />
              {d.districtPlay && <td className="text-right font-num text-[18px] font-bold tabular-nums text-navy">{wl(r.district)}</td>}
              <td className={`text-right font-num tabular-nums ${d.districtPlay ? "text-[17px]" : "text-[18px] font-bold text-navy"}`}>{wl(r.overall)}</td>
              <PointDiff r={r} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** An area's or region's table: every team in it, ranked by overall win %, then point difference (lib/standings-levels.ts). */
function Ranked({ id, title, league, rows, identities, level }: { id: string; title: string; league: string; rows: RankedRow[]; identities: Identities; level: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} className="mt-6">
      <Heading id={id} className={`scroll-mt-12 bg-navy px-3 py-1 font-num text-[18px] font-bold uppercase tracking-wider text-white ${level === 2 ? "sticky top-0 z-10" : ""}`}>
        {title}
      </Heading>
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">{league} · {title} standings</caption>
        <thead>
          <tr className="font-num text-[13px] uppercase tracking-wider text-muted">
            <th scope="col" className="w-8 py-1.5 pl-3 text-left font-semibold">
              <span aria-hidden="true">#</span>
              <span className="sr-only">Place</span>
            </th>
            <th scope="col" className="py-1.5 pl-1 text-left font-semibold">Team</th>
            <th scope="col" className="w-11 py-1.5 text-right font-semibold">
              <span aria-hidden="true">Dist</span>
              <span className="sr-only">District</span>
            </th>
            <th scope="col" className="w-[3.75rem] py-1.5 text-right font-semibold">Overall</th>
            <DiffHeader />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.school.slug} className="border-t border-line">
              <td className="pl-3 font-num text-[15px] tabular-nums text-muted">{i + 1}</td>
              <TeamCell r={r} identities={identities} />
              <td className="text-right font-num text-[17px] tabular-nums">{r.districtNumber}</td>
              <td className="text-right font-num text-[18px] font-bold tabular-nums text-navy">{wl(r.overall)}</td>
              <PointDiff r={r} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "UIL Division I": the league and division a district's table belongs to. */
const leagueOf = (d: DistrictStandings) => d.key.split("|")[0];

const RANKED_RULE = "Every team in it, ranked by overall win percentage, then point difference. League tiebreakers are not applied.";

/** Links to each region of one level, so a phone can skip four regions of tables. */
function JumpLinks({ level, regions }: { level: Level; regions: { id: string; label: string }[] }) {
  return (
    <nav aria-label={`Jump to a region (${level})`} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-3 font-num text-[15px] font-semibold uppercase tracking-wide">
      {regions.map((r) => (
        <a key={r.id} href={`#${r.id}`} className="inline-flex min-h-11 items-center text-navy underline-offset-2 hover:underline">
          {r.label}
        </a>
      ))}
    </nav>
  );
}

/** One region's heading over its areas and districts: sticky, so the region stays named while its tables scroll by. */
function RegionHeading({ id, label }: { id: string; label: string }) {
  return (
    <h2 id={id} className="sticky top-0 z-10 mt-6 scroll-mt-4 bg-navy px-3 py-1 font-num text-[18px] font-bold uppercase tracking-wider text-white">
      {label}
    </h2>
  );
}

function AreaHeading({ area }: { area: AreaGroup }) {
  return <h3 className="mt-4 border-b-2 border-navy px-3 pb-0.5 font-num text-[16px] font-bold uppercase tracking-wider text-navy">{area.label}</h3>;
}

/** The tables for one page's districts, at every level its alignment holds (ADR 0048). */
export function StandingsLevels({ districts, identities, idPrefix = "s" }: { districts: DistrictStandings[]; identities: Identities; idPrefix?: string }) {
  const levels = levelsOf(districts);
  const league = districts[0] ? leagueOf(districts[0]) : "";
  if (levels.length === 1) return <>{districts.map((d) => <District key={d.key} d={d} identities={identities} />)}</>;
  const at = (level: Level) => regionsOf(districts, `${idPrefix}-${level}`);
  const district = at("district");
  const area = at("area");
  const region = at("region");
  return (
    <LevelViews
      levels={levels}
      views={{
        district: (
          <>
            <JumpLinks level="district" regions={district} />
            {district.map((r) => (
              <section key={r.id} aria-labelledby={r.id}>
                <RegionHeading id={r.id} label={r.label} />
                {r.areas.map((a) => (
                  <div key={a.id}>
                    <AreaHeading area={a} />
                    {a.districts.map((d) => (
                      <District
                        key={d.key}
                        d={d}
                        identities={identities}
                        title={districtLabel(a, d)}
                        bar={<h4 id={districtId(d.key)} className="scroll-mt-12 bg-panel px-3 py-1 font-num text-[16px] font-bold uppercase tracking-wider text-navy">{districtLabel(a, d)}</h4>}
                      />
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </>
        ),
        area: (
          <>
            <p className="mt-3 px-3 text-[15px] text-muted">An area is the two districts that cross over in bi-district. {RANKED_RULE}</p>
            <JumpLinks level="area" regions={area} />
            {area.map((r) => (
              <section key={r.id} aria-labelledby={r.id}>
                <RegionHeading id={r.id} label={r.label} />
                {r.areas.map((a) => (
                  <Ranked key={a.id} id={a.id} title={a.label} league={league} rows={a.rows} identities={identities} level={3} />
                ))}
              </section>
            ))}
          </>
        ),
        region: (
          <>
            <p className="mt-3 px-3 text-[15px] text-muted">{RANKED_RULE}</p>
            <JumpLinks level="region" regions={region} />
            {region.map((r) => (
              <Ranked key={r.id} id={r.id} title={r.label} league={league} rows={r.rows} identities={identities} level={2} />
            ))}
          </>
        ),
      }}
    />
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
            ? `${districts.length} districts. District records count regular-season games only; overall records include playoff games. Ordered by district record, then overall; league tiebreakers are not applied. Scores may be corrected if a mistake is found.`
            : `${districts.length} groups. ${group.org.label} has no districts, so teams are grouped by division and region and ordered by overall record. Scores may be corrected if a mistake is found.`
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
      <StandingsLevels districts={districts} identities={identities} />
    </section>
  );
}
