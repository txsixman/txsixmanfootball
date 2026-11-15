import type { Metadata } from "next";
import { byDistrict, loadAlignments, placeLabel, uniquePrograms } from "@/lib/alignments";
import { programsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgByLeague } from "@/lib/orgs";
import { PageHeader } from "../ui";
import { districtPages } from "../standings/view";
import { Finder } from "./finder";
import { programsTitle } from "@/lib/titles";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  const programs = uniquePrograms(await loadAlignments()).length;
  return { title: programsTitle(), description: programsDescription(programs, ORGS.map((o) => o.label)), alternates: { canonical: "/programs" } };
}

export default async function Programs() {
  const [alignments, identities, districts] = await Promise.all([loadAlignments(), loadIdentities(), districtPages()]);
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
    </>
  );
}
