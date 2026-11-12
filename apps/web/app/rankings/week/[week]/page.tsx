import type { Metadata } from "next";
import { ORGS } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { rankingWeeks } from "@/lib/week-rankings";
import { WeekRankings } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const [season] = await ratingSeasons();
  return (await rankingWeeks(season)).map((w) => ({ week: String(w.number) }));
}

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  return { title: `UIL rankings after week ${(await params).week}` };
}

/** UIL's rankings as they stood at the end of a week of the season under way. */
export default async function WeekRankingsPage({ params }: { params: Promise<{ week: string }> }) {
  return <WeekRankings wanted={(await params).week} org={ORGS[0]} />;
}
