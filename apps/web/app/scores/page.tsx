import type { Metadata } from "next";
import { loadAlignments, slugify } from "@/lib/alignments";
import { scoresDescription } from "@/lib/descriptions";
import { loadGames } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { CURRENT_SEASON } from "@/lib/season";
import { weekHref } from "@/lib/week-review-hrefs";
import { latestReview } from "@/lib/week-review-load";
import { EmptyState, PageHeader } from "../ui";
import Board from "./board";
import { scoresTitle } from "@/lib/titles";

export const dynamic = "force-static";
export const metadata: Metadata = { title: scoresTitle(CURRENT_SEASON), description: scoresDescription(CURRENT_SEASON), alternates: { canonical: "/scores" } };

export default async function ScoresPage() {
  const games = await loadGames(await loadAlignments());
  const review = await latestReview();
  if (games.length) {
    const identities = await loadIdentities();
    const crests = Object.fromEntries(
      games.flatMap((g) => [g.home.name, g.away.name]).map((name) => [name, identities.get(slugify(name)) ?? EMPTY]),
    );
    return <Board games={games} eyebrow={`${CURRENT_SEASON} playoffs`} title="Scores" crests={crests} weekInReview={review && { href: weekHref(review.season, review.week), label: `Week in review: ${review.season} week ${review.week}` }} />;
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
