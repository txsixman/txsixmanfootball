import { NextResponse, type NextRequest } from "next/server";
import { closed, publicClient } from "@/lib/posts/api";

// A game's visible comments, for the comments block on /scores/<id> (a static page, so they load from here). Public:
// display name, text, time and an edited flag, never a user id, birth year or email. Never cached: a hidden comment must
// disappear at once, and a new one appear.
export const dynamic = "force-dynamic";

const PAGE = 30;
const KEY = /^[a-z0-9][a-z0-9-]{5,200}$/;
const NO_STORE = { "Cache-Control": "no-store" };

type Row = { id: string; author: string; body: string; created_at: string; edited: boolean; total: number };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = closed();
  if (off) return off;
  const { id } = await params;
  const empty = NextResponse.json({ comments: [], total: 0 }, { headers: NO_STORE });
  if (!KEY.test(id)) return empty;
  const offset = Math.min(Math.max(Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0, 0), 10_000);
  const supabase = publicClient();
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("list_comments", { p_game_key: id, p_offset: offset, p_limit: PAGE });
  if (error) {
    console.error("comments: read failed", error.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 502, headers: NO_STORE });
  }
  const rows = (data ?? []) as Row[];
  return NextResponse.json(
    {
      comments: rows.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at, edited: r.edited })),
      total: rows[0]?.total ?? 0,
    },
    { headers: NO_STORE },
  );
}
