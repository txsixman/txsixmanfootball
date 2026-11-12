import { NextResponse } from "next/server";
import { closed, publicClient } from "@/lib/posts/api";

// What a game page may say about fans' score reports (fan_score_status, migration 0014): how many reports came in, and a
// score only once it is confirmed. Never who reported, never an unconfirmed score. Public, never cached.
export const dynamic = "force-dynamic";

const KEY = /^[a-z0-9][a-z0-9-]{5,200}$/;
const NO_STORE = { "Cache-Control": "no-store" };
type Row = { reports: number; confirmed: boolean; home_score: number | null; away_score: number | null; basis: string | null };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const off = closed();
  if (off) return off;
  const { id } = await params;
  const none = { reports: 0, confirmed: false };
  const supabase = KEY.test(id) ? publicClient() : null;
  if (!supabase) return NextResponse.json(none, { headers: NO_STORE });
  const { data, error } = await supabase.rpc("fan_score_status", { p_game_key: id });
  if (error) {
    console.error("score report: read failed", error.code ?? "unknown");
    return NextResponse.json({ error: "failed" }, { status: 502, headers: NO_STORE });
  }
  const row = (data as Row[] | null)?.[0];
  if (!row) return NextResponse.json(none, { headers: NO_STORE });
  return NextResponse.json(
    row.confirmed
      ? { reports: row.reports, confirmed: true, homeScore: row.home_score, awayScore: row.away_score, basis: row.basis }
      : { reports: row.reports, confirmed: false },
    { headers: NO_STORE },
  );
}
