import type { NextRequest } from "next/server";
import { z } from "zod";
import { closed, fail, fanFor, ok, readJson, refusal } from "@/lib/posts/api";

// Report a game's final score. The database decides everything else: the game must exist, be unscored and be on or past its
// day; the account must not be banned or muted; one report per account per game (submit_score_report, migration 0014).
export const dynamic = "force-dynamic";

const Body = z.object({ gameKey: z.string().regex(/^[a-z0-9][a-z0-9-]{5,200}$/), home: z.number().int().min(0).max(199), away: z.number().int().min(0).max(199) });

export async function POST(request: NextRequest) {
  const off = closed();
  if (off) return off;
  const found = await fanFor(request);
  if ("response" in found) return found.response;
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail("bad_score");
  const { fan } = found;
  if (fan.banned) return fail("banned");
  if (fan.muted) return fail("muted");
  const { error } = await fan.supabase.rpc("submit_score_report", { p_game_key: parsed.data.gameKey, p_home: parsed.data.home, p_away: parsed.data.away });
  if (error) return refusal(error);
  return ok();
}
