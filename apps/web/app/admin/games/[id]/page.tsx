import Link from "next/link";
import { notFound } from "next/navigation";
import { idSeason } from "@/lib/admin/files";
import { adminContext, loadLiveCorrections, loadLiveGames, SEARCH_SEASONS } from "@/lib/admin/service";
import { correctionKey } from "@/lib/corrections";
import { AdminNav } from "../../nav";
import { GameFixForm } from "../../forms";
import { gate } from "../../gate";

export const dynamic = "force-dynamic";

export default async function GameFixPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.page;
  const { id } = await params;
  const season = idSeason(id);
  if (!season || !SEARCH_SEASONS.includes(season)) notFound();
  const { github } = await adminContext();
  const live = await loadLiveCorrections(github);
  const game = (await loadLiveGames(github, season, live.merges)).find((x) => x.id === id);
  if (!game) notFound();
  const fix = live.games.get(correctionKey(game.date, game.home, game.away));
  return (
    <section aria-labelledby="admin-title">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[36px] font-bold uppercase leading-none tracking-wide text-navy">{game.away} at {game.home}</h1>
      <p className="mt-2 text-[15px] text-muted">{game.date} · as read: {game.away} {game.awayScore}, {game.home} {game.homeScore}</p>
      {fix && (
        <p className="mt-3 max-w-md border-l-4 border-red bg-panel px-3 py-2 text-[14px]">
          Corrected already: {fix.action === "void" ? "voided" : fix.action === "forfeit" ? "forfeit" : `${fix.away_score}-${fix.home_score}`} ({fix.reason}). A new correction replaces it; the old one stays in the history.
        </p>
      )}
      <GameFixForm id={game.id} home={game.home} away={game.away} homeScore={game.homeScore} awayScore={game.awayScore} />
      <p className="mt-6"><Link href="/admin" className="text-[15px] font-semibold text-navy underline">Back to search</Link></p>
    </section>
  );
}
