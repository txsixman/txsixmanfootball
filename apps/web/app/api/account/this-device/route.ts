import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { getPushMutes, isCenterError, thisDevice } from "@/lib/account/center";
import { checkSameOriginJson } from "@/lib/same-origin";

// Which of the account's devices is THIS browser, and which teams are muted on it (ADR 0058, migration 0026): `{ endpoint }` in,
// `{ id, muted }` out. `id` is the device id the account page lists (null when this browser is not linked to this account), so the
// page can mark "This browser" without any endpoint ever leaving the database. The endpoint is a capability URL (ADR 0054): checked
// for shape, never logged, never echoed back. Checked here (a same-site POST, a session, the shape) and again by the database.
export const dynamic = "force-dynamic";

const Endpoint = z.string().max(1024).refine((v) => v.startsWith("https://") && URL.canParse(v));
const Body = z.object({ endpoint: Endpoint });

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
  const device = await thisDevice(found.supabase, parsed.data.endpoint);
  if (isCenterError(device)) return reply({ error: "unavailable" }, 503);
  const muted = device.id ? await getPushMutes(found.supabase, parsed.data.endpoint) : [];
  return isCenterError(muted) ? reply({ error: "unavailable" }, 503) : reply({ id: device.id, muted });
}
