import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkText } from "@/lib/moderation/check";
import { closed, fail, fanFor, ok, readJson, refusal } from "@/lib/posts/api";

// Post a comment under a game page. The database checks everything again (add_comment, migration 0013).
export const dynamic = "force-dynamic";

const Body = z.object({ gameKey: z.string().regex(/^[a-z0-9][a-z0-9-]{5,200}$/), body: z.string().max(4000) });

export async function POST(request: NextRequest) {
  const off = closed();
  if (off) return off;
  const found = await fanFor(request);
  if ("response" in found) return found.response;
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail("bad_text");
  const { fan } = found;
  if (fan.banned) return fail("banned");
  if (fan.muted) return fail("muted");
  const problem = checkText(parsed.data.body, { established: fan.established });
  if (problem) return fail(problem);
  const { data, error } = await fan.supabase.rpc("add_comment", { p_game_key: parsed.data.gameKey, p_body: parsed.data.body });
  if (error) return refusal(error);
  return ok({ id: data, author: fan.displayName });
}
