import type { Metadata } from "next";
import { describeRankings, RankingsView, VIEWS } from "./view";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Rankings", description: await describeRankings(VIEWS[0]), alternates: { canonical: "/rankings" } };
}

export default function RankingsPage() {
  return <RankingsView view={VIEWS[0]} />;
}
