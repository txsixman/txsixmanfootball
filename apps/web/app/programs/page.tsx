import type { Metadata } from "next";
import { byDistrict, loadAlignments, placeLabel, uniquePrograms } from "@/lib/alignments";
import { programsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgByLeague } from "@/lib/orgs";
import { PageHeader } from "../ui";
import { Finder } from "./finder";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  const programs = uniquePrograms(await loadAlignments()).length;
  return { title: "Programs", description: programsDescription(programs, ORGS.map((o) => o.label)) };
}

export default async function Programs() {
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const groups = byDistrict(alignments).map((g) => ({
    org: orgByLeague(g.schools[0].league)!.slug,
    heading: g.heading,
    place: placeLabel(g),
    key: `${g.heading}|${g.district}`,
    schools: g.schools.map((s) => ({ slug: s.slug, school: s.school, identity: identities.get(s.slug) ?? EMPTY })),
  }));

  return (
    <>
      <PageHeader eyebrow={ORGS.map((o) => o.label).join(" · ")} title="Programs" />
      <Finder groups={groups} />
    </>
  );
}
