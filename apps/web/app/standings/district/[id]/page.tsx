import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { slugify } from "@/lib/alignments";
import { districtStandingsDescription } from "@/lib/descriptions";
import { gameKey, loadSeasonResults, playoffGameKeys } from "@/lib/games";
import { loadIdentities } from "@/lib/identity";
import { CURRENT_SEASON } from "@/lib/season";
import { type DistrictStandings, standingsHref } from "@/lib/standings";
import { levelsOf, regionsOf } from "@/lib/standings-levels";
import { standingsTitle } from "@/lib/titles";
import { Breadcrumbs } from "../../../breadcrumbs";
import { PageHeader, SectionBar } from "../../../ui";
import { District, districtPages, hrefOf } from "../../view";

// One district's own page (/standings/district/uil-division-i-district-8): its table, every district game of the season
// with its score and game page, and links to the other districts of its division. District games are regular-season
// games between two of its teams (lib/standings.ts); a playoff game never counts. Scores are away team first; no game's
// winner is named (ADR 0004), and the records may rest on unconfirmed scores (ADR 0013).
export const dynamic = "force-static";
export const dynamicParams = false;

const SEASON = CURRENT_SEASON;
type Props = { params: Promise<{ id: string }> };
const idOf = (href: string) => href.slice("/standings/district/".length);

export async function generateStaticParams() {
  return (await districtPages()).map((p) => ({ id: idOf(p.href) }));
}

async function find(id: string) {
  const pages = await districtPages();
  const page = pages.find((p) => idOf(p.href) === id);
  // The other districts of its division (a TAPPS page holds several divisions, each numbered from 1).
  return page && { ...page, siblings: pages.filter((p) => p.heading === page.heading) };
}

/** "Region 2", when the alignment numbers its regions. */
const regionOf = (d: DistrictStandings) => (/^\d+$/.test(d.rows[0].school.region) ? `Region ${d.rows[0].school.region}` : undefined);

async function districtGames(d: DistrictStandings) {
  const [results, playoffs] = await Promise.all([loadSeasonResults(SEASON), playoffGameKeys(SEASON)]);
  const teams = new Set(d.rows.map((r) => r.school.slug));
  return results
    .filter((r) => teams.has(slugify(r.home)) && teams.has(slugify(r.away)) && !playoffs.has(gameKey(r.date, r.home, r.away)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.home.localeCompare(b.home));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await find(id);
  if (!found) return { title: "Standings" };
  const label = `${found.heading} District ${found.number}`;
  return {
    title: standingsTitle({ label, season: SEASON }),
    description: districtStandingsDescription({ label, season: SEASON, teams: found.d.rows.length, games: (await districtGames(found.d)).length }),
    alternates: { canonical: found.href },
  };
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default async function DistrictPage({ params }: Props) {
  const { id } = await params;
  const found = await find(id);
  if (!found) notFound();
  const { d, group, heading, siblings, number } = found;
  const [identities, games] = await Promise.all([loadIdentities(), districtGames(d)]);
  const region = regionOf(d);
  const groupHref = hrefOf(group);
  // The bi-district partner: the other district of this one's area, where the alignment has areas (ADR 0048).
  const area = levelsOf(siblings.map((s) => s.d)).includes("area")
    ? regionsOf(siblings.map((s) => s.d)).flatMap((r) => r.areas).find((a) => a.districts.some((x) => x.key === d.key))
    : undefined;
  const partner = area && siblings.find((s) => s.d.key !== d.key && area.districts.some((x) => x.key === s.d.key));
  const title = `District ${number}`;

  return (
    <>
      <Breadcrumbs
        trail={[
          { name: "Home", href: "/" },
          { name: "Standings", href: groupHref },
          { name: `${heading} ${title}`, href: found.href },
        ]}
      />
      <section aria-labelledby="district" className="mt-4">
        <PageHeader
          id="district"
          size="md"
          eyebrow={[`${SEASON} season`, heading, region].filter(Boolean).join(" · ")}
          title={title}
          note={`${d.rows.length} teams. District records count regular-season games between these teams; overall records include every game, playoffs too. Ordered by district record, then overall; league tiebreakers are not applied. Scores may be corrected if a mistake is found.`}
        />

        <District d={d} identities={identities} linked={false} />

        <section aria-labelledby="games" className="mt-8">
          <SectionBar id="games" title="District games" aside={`${games.length} played`} className="" />
          {games.length ? (
            <ul>
              {games.map((g) => (
                <li key={g.id} className="flex items-center gap-3 border-b border-line px-3 text-[15px]">
                  <span className="w-[6.5rem] shrink-0 font-num text-[14px] font-semibold uppercase text-muted">{day(g.date)}</span>
                  <Link href={g.href} prefetch={false} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-ink hover:text-navy hover:underline">
                    <span className="min-w-0">
                      {g.away} vs {g.home}
                    </span>
                    <span className="shrink-0 font-num text-[17px] font-bold tabular-nums">{g.forfeit ? "Forfeit" : `${g.awayScore}-${g.homeScore}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-[15px] text-muted">No district game has been played yet.</p>
          )}
          {games.length > 0 && <p className="mt-2 px-3 text-[13px] text-muted">Away team first.</p>}
        </section>

        <nav aria-label="More standings" className="mt-6 flex flex-wrap gap-x-5">
          {partner && area && (
            <Link href={partner.href} className="link-more">
              {`District ${partner.number}, its bi-district partner`}
            </Link>
          )}
          {area && (
            <Link href={`${groupHref}?view=area#${area.id}`} className="link-more">
              {`${area.label.replace(/^Region \d+ · /, "")} standings`}
            </Link>
          )}
          <Link href={standingsHref(d)} className="link-more">
            {`All ${heading} standings`}
          </Link>
        </nav>

        <nav aria-label={`${heading} districts`} className="mt-6">
          <h2 className="section-title">{`${heading} districts`}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {siblings.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  prefetch={false}
                  aria-current={s.href === found.href ? "page" : undefined}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-navy px-2 font-num text-[16px] font-bold tabular-nums ${
                    s.href === found.href ? "bg-band text-white" : "text-navy hover:bg-panel"
                  }`}
                >
                  <span className="sr-only">District </span>
                  {s.number}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </>
  );
}
