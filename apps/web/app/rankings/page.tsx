import type { Metadata } from "next";
import { describeRankings, RankingsView, VIEWS } from "./view";
import { rankingsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: rankingsTitle({ label: "UIL", season: CURRENT_SEASON }), description: await describeRankings(VIEWS[0]), alternates: { canonical: "/rankings" } };
}

export default function RankingsPage() {
  return <RankingsView view={VIEWS[0]} />;
}
