import type { Metadata } from "next";
import { ORGS } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { rankingWeeks } from "@/lib/week-rankings";
import { describeWeekRankings, WeekRankings } from "../view";
import { rankingsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const [season] = await ratingSeasons();
  return (await rankingWeeks(season)).map((w) => ({ week: String(w.number) }));
}

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params;
  return { title: rankingsTitle({ label: "UIL", season: CURRENT_SEASON, week: Number(week) }), description: await describeWeekRankings(ORGS[0], week), alternates: { canonical: `/rankings/week/${week}` } };
}

/** UIL's rankings as they stood at the end of a week of the season under way. */
export default async function WeekRankingsPage({ params }: { params: Promise<{ week: string }> }) {
  return <WeekRankings wanted={(await params).week} org={ORGS[0]} />;
}
