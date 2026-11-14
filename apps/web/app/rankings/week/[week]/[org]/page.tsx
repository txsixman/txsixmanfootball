import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { rankingWeeks } from "@/lib/week-rankings";
import { describeWeekRankings, WeekRankings } from "../../view";
import { rankingsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

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
  const found = orgBySlug(org);
  return {
    title: found ? rankingsTitle({ label: found.label, season: CURRENT_SEASON, week: Number(week) }) : "Rankings",
    ...(found && { description: await describeWeekRankings(found, week) }),
    alternates: { canonical: `/rankings/week/${week}/${org}` },
  };
}

/** One of the other organizations' rankings as they stood at the end of a week of the season under way. */
export default async function WeekOrgRankingsPage({ params }: Props) {
  const { week, org } = await params;
  const found = orgBySlug(org);
  if (!found || found.slug === "uil") notFound();
  return <WeekRankings wanted={week} org={found} />;
}
