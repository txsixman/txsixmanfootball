import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { rankingWeeks } from "@/lib/week-rankings";
import { WeekRankings } from "../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ week: string; org: string }> };

export async function generateStaticParams() {
  const [season] = await ratingSeasons();
  const orgs = await orgParams();
  return (await rankingWeeks(season)).flatMap((w) => orgs.map((o) => ({ week: String(w.number), org: o.org })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { week, org } = await params;
  return { title: `${orgBySlug(org)?.label ?? ""} rankings after week ${week}` };
}

/** One of the other organizations' rankings as they stood at the end of a week of the season under way. */
export default async function WeekOrgRankingsPage({ params }: Props) {
  const { week, org } = await params;
  const found = orgBySlug(org);
  if (!found || found.slug === "uil") notFound();
  return <WeekRankings wanted={week} org={found} />;
}
