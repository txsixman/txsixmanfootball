import type { Metadata } from "next";
import { describeStandings, GROUPS, StandingsView } from "./view";
import { standingsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: standingsTitle({ label: "UIL Division I", season: CURRENT_SEASON }), description: await describeStandings(GROUPS[0]), alternates: { canonical: "/standings" } };
}

export default function StandingsPage() {
  return <StandingsView group={GROUPS[0]} />;
}
