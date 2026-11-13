import type { Metadata } from "next";
import { EMPTY } from "@/lib/identity";
import type { RatingsTable as Table } from "@/lib/ratings";
import sample from "@/lib/demo-ratings.json";
import { HowToRead, RankingsHeader, RatingsTable } from "../table";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Sample rankings", robots: { index: false } };

// services/ratings/sample-games.csv, rated by the real model. Invented schools only.
export default function SampleRatingsPage() {
  const table = sample as Table;
  const rows = table.teams.map((r) => ({ ...r, name: r.team, identity: EMPTY }));
  return (
    <section aria-labelledby="rankings">
      <RankingsHeader eyebrow="Sample rankings. Invented schools." note={`${rows.length} teams from ${table.games} games`} />
      <RatingsTable rows={rows} />
      <HowToRead />
    </section>
  );
}
