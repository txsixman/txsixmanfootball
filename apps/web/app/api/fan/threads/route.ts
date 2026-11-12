import type { NextRequest } from "next/server";
import { z } from "zod";
import { MAX_TITLE_LENGTH, checkText } from "@/lib/moderation/check";
import { BOARDS } from "@/lib/forum-boards";
import { closed, fail, fanFor, ok, readJson, refusal } from "@/lib/posts/api";

// Start a forum thread: a board, a title and the opening post (create_thread, migration 0015).
export const dynamic = "force-dynamic";

const Body = z.object({ board: z.enum(BOARDS.map((b) => b.slug) as [string, ...string[]]), title: z.string().max(400), body: z.string().max(4000) });

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
  const problem =
    checkText(parsed.data.title, { established: fan.established, max: MAX_TITLE_LENGTH }) ?? checkText(parsed.data.body, { established: fan.established });
  if (problem) return fail(problem);
  const { data, error } = await fan.supabase.rpc("create_thread", { p_board: parsed.data.board, p_title: parsed.data.title, p_body: parsed.data.body });
  if (error) return refusal(error);
  return ok({ id: data });
}
