import { NextResponse, type NextRequest } from "next/server";
import { closed, publicClient } from "@/lib/posts/api";
import { parseCountKeys } from "@/lib/posts/comment-counts";

// How many visible comments each of up to 200 games has, for the score cards (ADR 0078): GET ?keys=k1,k2,... answers
// { counts: { <key>: <n> } } with only the games that have at least one. Public: a key and a number, nothing that names
// anyone. Cached at the edge for 30 seconds, so a count can lag by that much and game-night traffic reads the database
// once per distinct list of keys, not once per visitor (a hidden comment still disappears from the comments themselves
// at once: that read is never cached).
export const dynamic = "force-dynamic";

const CACHED = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };
const NO_STORE = { "Cache-Control": "no-store" };

type Row = { game_key: string; comments: number };

export async function GET(request: NextRequest) {
  const off = closed();
  if (off) return off;
  const keys = parseCountKeys(request.nextUrl.searchParams.get("keys"));
  const empty = NextResponse.json({ counts: {} }, { headers: CACHED });
  if (!keys.length) return empty;
  const supabase = publicClient();
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("comment_counts", { p_game_keys: keys });
  if (error) {
    console.error("comments: count failed", error.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 502, headers: NO_STORE });
  }
  const asked = new Set(keys);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Row[]) if (asked.has(row.game_key) && row.comments > 0) counts[row.game_key] = row.comments;
  return NextResponse.json({ counts }, { headers: CACHED });
}
