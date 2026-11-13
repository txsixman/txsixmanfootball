import type { Metadata } from "next";
import { describeStandings, GROUPS, StandingsView } from "./view";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Standings", description: await describeStandings(GROUPS[0]), alternates: { canonical: "/standings" } };
}

export default function StandingsPage() {
  return <StandingsView group={GROUPS[0]} />;
}
