import type { Metadata } from "next";
import { loadAlignments, slugify } from "@/lib/alignments";
import { loadGames } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { CURRENT_SEASON } from "@/lib/season";
import { EmptyState, PageHeader } from "../ui";
import Board from "./board";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Scores | Project 80x40" };

export default async function ScoresPage() {
  const games = await loadGames(await loadAlignments());
  if (games.length) {
    const identities = await loadIdentities();
    const crests = Object.fromEntries(
      games.flatMap((g) => [g.home.name, g.away.name]).map((name) => [name, identities.get(slugify(name)) ?? EMPTY]),
    );
    return <Board games={games} eyebrow={`${CURRENT_SEASON} playoffs`} title="Scores" crests={crests} />;
  }
  return (
    <section aria-labelledby="scores" className="px-3 py-4">
      <PageHeader id="scores" eyebrow={`${CURRENT_SEASON} playoffs`} title="Scores" />
      <EmptyState action={{ href: "/scores/sample", label: "See a sample Friday night" }}>
        No games entered yet. Playoff games appear here as they come in.
      </EmptyState>
    </section>
  );
}
