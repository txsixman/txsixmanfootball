import type { Metadata } from "next";
import { loadAlignments, programFor, slugify } from "@/lib/alignments";
import { sideText } from "@/lib/bracket-fill";
import { loadBrackets } from "@/lib/brackets";
import { scoresDescription } from "@/lib/descriptions";
import { loadGames } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { projectionText } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { weekHref } from "@/lib/week-review-hrefs";
import { latestReview } from "@/lib/week-review-load";
import { EmptyState, PageHeader } from "../ui";
import Board, { type NextGame } from "./board";
import { scoresTitle } from "@/lib/titles";

export const dynamic = "force-static";
export const metadata: Metadata = { title: scoresTitle(CURRENT_SEASON), description: scoresDescription(CURRENT_SEASON), alternates: { canonical: "/scores" } };

export default async function ScoresPage() {
  const alignments = await loadAlignments();
  const games = await loadGames(alignments);
  // The next round's games the bracket sets before a site lists them (ADR 0047), one block per bracket and round.
  const next = (await loadBrackets(CURRENT_SEASON)).flatMap((b) =>
    b.rounds.flatMap((r) =>
      r.built.map((g): NextGame => {
        const side = (s: (typeof g.sides)[number]) => {
          const slug = "team" in s ? programFor(alignments, s.team, b.league)?.slug : undefined;
          return { name: sideText(s), ...(slug ? { href: `/programs/${slug}` } : {}) };
        };
        return { key: `${b.name}|${r.round}|${g.sides.map(sideText).join("|")}`, org: b.league, heading: `${b.name} · ${r.label}`, sides: [side(g.sides[0]), side(g.sides[1])], ...(g.projection ? { projected: projectionText(g.projection) } : {}) };
      }),
    ),
  );
  const review = await latestReview();
  if (games.length) {
    const identities = await loadIdentities();
    const crests = Object.fromEntries(
      games.flatMap((g) => [g.home.name, g.away.name]).map((name) => [name, identities.get(slugify(name)) ?? EMPTY]),
    );
    return <Board games={games} eyebrow={`${CURRENT_SEASON} playoffs`} title="Scores" crests={crests} weekInReview={review && { href: weekHref(review.season, review.week), label: `Week in review: ${review.season} week ${review.week}` }} next={next} />;
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
