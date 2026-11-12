import type { Metadata } from "next";
import { GROUPS, StandingsView } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Standings | Project 80x40" };

export default function StandingsPage() {
  return <StandingsView group={GROUPS[0]} />;
}
