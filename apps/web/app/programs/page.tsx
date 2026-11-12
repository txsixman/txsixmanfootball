import type { Metadata } from "next";
import { byDistrict, loadAlignments, placeLabel } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { ORGS, orgByLeague } from "@/lib/orgs";
import { PageHeader } from "../ui";
import { Finder } from "./finder";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Programs | Project 80x40" };

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
