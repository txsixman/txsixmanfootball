import type { Metadata } from "next";
import { RankingsView, VIEWS } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Rankings | Project 80x40" };

export default function RankingsPage() {
  return <RankingsView view={VIEWS[0]} />;
}
