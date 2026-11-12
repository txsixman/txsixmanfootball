import type { NextRequest } from "next/server";
import { z } from "zod";
import { closed, fail, fanFor, ok, refusal } from "@/lib/posts/api";

// Flag a comment or forum post. Three different established accounts hide it, in the database (flag_post, migration 0013).
// The answer is the same whether or not this flag was the one that hid it.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = closed();
  if (off) return off;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("not_found");
  const found = await fanFor(request);
  if ("response" in found) return found.response;
  const { error } = await found.fan.supabase.rpc("flag_post", { p_post: id });
  if (error) return refusal(error);
  return ok();
}
