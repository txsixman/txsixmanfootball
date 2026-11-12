import type { Metadata } from "next";
import { GROUPS, StandingsView } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Standings", alternates: { canonical: "/standings" } };

export default function StandingsPage() {
  return <StandingsView group={GROUPS[0]} />;
}
