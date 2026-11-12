import type { NextRequest } from "next/server";
import { z } from "zod";
import { MAX_TITLE_LENGTH, checkText } from "@/lib/moderation/check";
import { closed, fail, fanFor, ok, readJson, refusal } from "@/lib/posts/api";

// Edit my own comment or forum post. The earlier version is kept in the database (edit_post, migration 0013).
export const dynamic = "force-dynamic";

const Body = z.object({ body: z.string().max(4000), title: z.string().max(400).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = closed();
  if (off) return off;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("not_found");
  const found = await fanFor(request);
  if ("response" in found) return found.response;
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail("bad_text");
  const { fan } = found;
  if (fan.banned) return fail("banned");
  if (fan.muted) return fail("muted");
  const problem =
    checkText(parsed.data.body, { established: fan.established }) ??
    (parsed.data.title === undefined ? null : checkText(parsed.data.title, { established: fan.established, max: MAX_TITLE_LENGTH }));
  if (problem) return fail(problem);
  const { error } = await fan.supabase.rpc("edit_post", { p_post: id, p_body: parsed.data.body, p_title: parsed.data.title ?? null });
  if (error) return refusal(error);
  return ok();
}
