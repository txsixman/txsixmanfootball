import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { isCenterError, setPushMute } from "@/lib/account/center";
import { checkSameOriginJson } from "@/lib/same-origin";

// Mute or unmute one team's alerts on THIS browser (ADR 0058, migration 0026). The browser knows its own push endpoint; this route
// sends it to the database, which matches it to auth.uid()'s own linked row, so another account's endpoint changes nothing. The
// endpoint is a capability URL (ADR 0054): checked for shape, never logged, never echoed back. Checked here (a same-site POST, a
// session, the shapes) and again by the database (set_push_mute). The answer is the browser's muted teams.
export const dynamic = "force-dynamic";

const Slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Endpoint = z.string().max(1024).refine((v) => v.startsWith("https://") && URL.canParse(v));
const Body = z.object({ endpoint: Endpoint, slug: Slug, muted: z.boolean() });

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" } });

export async function POST(request: NextRequest) {
  if (!fanSignIn()) return reply({ error: "not found" }, 404); // fan accounts are off
  const lock = checkSameOriginJson(request.headers);
  if (lock === "origin") return reply({ error: "forbidden" }, 403);
  if (lock === "type") return reply({ error: "bad request" }, 415);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "bad request" }, 400);
  const found = await getUser();
  if (!found) return reply({ error: "sign in" }, 401);
  const muted = await setPushMute(found.supabase, parsed.data.endpoint, parsed.data.slug, parsed.data.muted);
  return isCenterError(muted) ? reply({ error: "unavailable" }, 503) : reply({ muted });
}
