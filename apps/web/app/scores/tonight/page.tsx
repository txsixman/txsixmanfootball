import type { Metadata } from "next";
import { nightTitle } from "@/lib/game-night";
import { centralClock } from "@/lib/playoff-status";
import { loadNight } from "@/lib/tonight";
import { EmptyState, PageHeader } from "../../ui";
import TonightBoard from "./board";

// Static, like the other score pages: which night it is, and the games on it, are worked out when the site is built
// (every results commit rebuilds it on game nights), so the page says when. The live line of a game under way is the one
// part read in the browser (app/scores/live-score.tsx).
export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Tonight's games",
  description: "Every Texas six-man game of the night, by organization and round, with live scores while they are played.",
};

export default async function TonightPage() {
  const night = await loadNight();
  const updated = centralClock().label;
  return (
    <>
      <header className="border-b-2 border-navy px-3 pb-3 pt-4">
        <PageHeader
          eyebrow={nightTitle(night.night)}
          title="Tonight"
          note={
            night.count
              ? `${night.count} ${night.count === 1 ? "game" : "games"}, each organization on its own. Scores are not confirmed and may change.`
              : undefined
          }
        />
        <p className="mt-2 text-[13px] text-muted">Page updated {updated}</p>
      </header>
      {night.count ? (
        <TonightBoard night={night} />
      ) : (
        <div className="px-3 pb-6">
          <EmptyState action={{ href: "/scores", label: "See every playoff game" }}>No games are listed for {nightTitle(night.night)}.</EmptyState>
        </div>
      )}
    </>
  );
}
