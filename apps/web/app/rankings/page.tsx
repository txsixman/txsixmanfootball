import type { Metadata } from "next";
import { RankingsView, VIEWS } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Rankings", alternates: { canonical: "/rankings" } };

export default function RankingsPage() {
  return <RankingsView view={VIEWS[0]} />;
}
