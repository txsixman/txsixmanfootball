import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchGames } from "@/lib/admin/files";
import { SearchInput } from "@/lib/admin/inputs";
import { adminContext, loadLiveCorrections, loadLiveGames, SEARCH_SEASONS } from "@/lib/admin/service";
import { CURRENT_SEASON } from "@/lib/season";
import { correctionKey } from "@/lib/corrections";
import { AdminNav } from "./nav";
import { gate } from "./gate";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const g = await gate();
  if (!g.ok) return g.page;
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const searched = str("q") !== undefined || str("date") !== undefined;
  const input = searched ? SearchInput.safeParse({ q: str("q") || undefined, date: str("date") || undefined }) : undefined;

  let results: Awaited<ReturnType<typeof searchResults>> | undefined;
  if (input?.success) results = await searchResults(input.data, Number(str("season")));

  return (
    <section aria-labelledby="admin-title">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Find a game</h1>
      <form action="/admin" method="get" className="mt-4 grid max-w-md gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Team</Label>
          <Input id="q" name="q" defaultValue={str("q")} autoComplete="off" maxLength={80} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" defaultValue={str("date")} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="season">Season (when no date is given)</Label>
          <select id="season" name="season" defaultValue={str("season") ?? String(CURRENT_SEASON)} className="min-h-11 border border-input bg-background px-3 text-[16px]">
            {SEARCH_SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {input && !input.success && <p className="mt-4 text-[15px] font-semibold text-red" role="alert">{input.error.issues[0]?.message}</p>}
      {results && (
        <>
          <h2 className="mt-6 text-[13px] font-bold uppercase tracking-widest text-red">{results.found.length} game{results.found.length === 1 ? "" : "s"}{results.more ? " (first 40)" : ""}</h2>
          <ul className="mt-2 max-w-md border-t border-line">
            {results.found.map((game) => (
              <li key={game.id} className="border-b border-line">
                <Link href={`/admin/games/${game.id}`} className="flex min-h-14 flex-col justify-center py-1 text-[15px] hover:bg-accent">
                  <span className="font-semibold text-navy">{game.away} at {game.home}</span>
                  <span className="text-[13px] text-muted">
                    {game.date} · {game.awayScore}-{game.homeScore}
                    {results.fixed.has(correctionKey(game.date, game.home, game.away)) ? " · corrected" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

async function searchResults(input: { q?: string; date?: string }, seasonParam: number) {
  const { github } = await adminContext();
  const live = await loadLiveCorrections(github);
  const season = input.date ? Number(input.date.slice(0, 4)) : SEARCH_SEASONS.includes(seasonParam) ? seasonParam : CURRENT_SEASON;
  const games = SEARCH_SEASONS.includes(season) ? await loadLiveGames(github, season, live.merges) : [];
  return { ...searchGames(games, input), fixed: new Set(live.games.keys()) };
}
