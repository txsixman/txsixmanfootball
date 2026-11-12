import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkText } from "@/lib/moderation/check";
import { closed, fail, fanFor, ok, readJson, refusal } from "@/lib/posts/api";

// Reply to a forum thread (reply_to_thread, migration 0015).
export const dynamic = "force-dynamic";

const Body = z.object({ threadId: z.uuid(), body: z.string().max(4000) });

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
  const { data, error } = await fan.supabase.rpc("reply_to_thread", { p_thread: parsed.data.threadId, p_body: parsed.data.body });
  if (error) return refusal(error);
  return ok({ id: data });
}
