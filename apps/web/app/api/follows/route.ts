import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fanSignIn } from "@/lib/auth/config";
import { getFollows } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { checkSameOriginJson } from "@/lib/same-origin";

// Change the signed-in fan's follows. Checked here (a same-site POST, a session, a slug's shape) and again by the
// database (follow_program: own rows only, a profile, the shape, at most 100; migration 0012). The site cannot tell here
// whether a slug is a real program (the program list is not in this function's files); an unknown one is harmless, shown
// nowhere, and the 100 cap bounds it. Nothing is logged.
export const dynamic = "force-dynamic";

const Slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("follow"), slug: Slug }),
  z.object({ op: z.literal("unfollow"), slug: Slug }),
  z.object({ op: z.literal("import"), slugs: z.array(Slug).max(100) }),
]);

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" } });

export async function POST(request: NextRequest) {
  if (!fanSignIn()) return reply({ error: "not found" }, 404); // fan accounts are off
  // The same lock as every fan write (lib/same-origin.ts): this site's own Origin, and a JSON body.
  const lock = checkSameOriginJson(request.headers);
  if (lock === "origin") return reply({ error: "forbidden" }, 403);
  if (lock === "type") return reply({ error: "bad request" }, 415);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "bad request" }, 400);
  const found = await getUser();
  if (!found) return reply({ error: "sign in" }, 401);
  const { supabase } = found;
  const body = parsed.data;

  const slugs = body.op === "import" ? [...new Set(body.slugs)] : [body.slug];
  const call = body.op === "unfollow" ? "unfollow_program" : "follow_program";
  // An import is several follows; a few at a time, never a hundred at once.
  for (let i = 0; i < slugs.length; i += 10) {
    const results = await Promise.all(slugs.slice(i, i + 10).map((p_slug) => supabase.rpc(call, { p_slug })));
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      // 53400: the account is full. 42501: not allowed (sign-up not finished). 22023: not a slug.
      const code = failed.error.code;
      if (code === "53400") return reply({ error: "limit" }, 409);
      if (code === "42501") return reply({ error: "finish sign-up" }, 403);
      if (code === "22023") return reply({ error: "bad request" }, 400);
      return reply({ error: "unavailable" }, 503);
    }
  }
  try {
    return reply({ follows: await getFollows(supabase) });
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
