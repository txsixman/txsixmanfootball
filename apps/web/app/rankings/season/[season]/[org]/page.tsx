import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { RankingsView, viewOf } from "../../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ season: string; org: string }> };

/** Every past season for every organization but UIL, which is /rankings/season/<year> itself. */
const pastSeasons = async () => (await ratingSeasons()).slice(1);

export async function generateStaticParams() {
  const orgs = await orgParams();
  return (await pastSeasons()).flatMap((s) => orgs.map((o) => ({ season: String(s), org: o.org })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season, org } = await params;
  return { title: `${season} ${orgBySlug(org)?.label ?? ""} rankings`, alternates: { canonical: `/rankings/season/${season}/${org}` } };
}

export default async function SeasonOrgRankingsPage({ params }: Props) {
  const { season, org } = await params;
  const found = orgBySlug(org);
  if (!found || found.slug === "uil" || !(await pastSeasons()).includes(Number(season))) notFound();
  return <RankingsView view={viewOf(found)} season={Number(season)} />;
}
