import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { deviceLabel } from "@/lib/account/center";
import { logDbFailure } from "@/lib/log-db";
import { checkSameOriginJson } from "@/lib/same-origin";

// Link this browser's push subscription to the signed-in fan's account (ADR 0054, migration 0023), so the account's follows
// on any device drive the alerts this browser shows. The auth cookies are httpOnly, so the page's script cannot call the
// database as the fan; this route does, on the fan's own session, and the database ties the endpoint to auth.uid(): no user
// id comes from the browser. A push endpoint is a capability URL (anyone holding it can push to the browser), so it is
// treated as a secret here: never logged, never echoed back. A database failure is logged by its code only (lib/log-db.ts).
//
// Checked here (a same-site POST, a session, the shape of the three fields) and again by the database (link_push_subscription:
// a profile, the endpoint's host, the keys' shape, room in the table, at most 5 browsers an account).
export const dynamic = "force-dynamic";

const Body = z.object({ endpoint: z.string().max(1024), p256dh: z.string().max(120), auth: z.string().max(40) });

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
  const { data, error } = await found.supabase.rpc("link_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
  });
  if (error) {
    // 42501: not allowed (sign-up not finished). 23514 (a check) and 22001/22P02 (a malformed value): not a push subscription.
    if (error.code === "42501") return reply({ error: "finish sign-up" }, 403);
    if (error.code === "23514" || error.code === "22001" || error.code === "22P02") return reply({ error: "bad request" }, 400);
    logDbFailure("push link", "link_push_subscription", error.code);
    return reply({ error: "unavailable" }, 503);
  }
  // Give the browser the short label the account page lists it by ("Chrome on iPhone", ADR 0058, migration 0026). Only that label is
  // kept, never the User-Agent, and it is not logged. It is a convenience: a failure here leaves the link in place.
  // rpc() answers a refusal as `error`; it throws only when the network fails. Either way the link stands without a label.
  try {
    const { error: labelError } = await found.supabase.rpc("label_push_subscription", { p_endpoint: parsed.data.endpoint, p_label: deviceLabel(request.headers.get("user-agent") ?? "") });
    if (labelError) logDbFailure("push link", "label_push_subscription", labelError.code);
  } catch {
    logDbFailure("push link", "label_push_subscription");
  }
  // The programs this browser still follows by itself: the ones that did not fit on the account (usually none).
  const left = z.array(z.string()).safeParse(data);
  if (left.success) return reply({ programs: left.data });
  logDbFailure("push link", "link_push_subscription", "unexpected answer");
  return reply({ error: "unavailable" }, 503);
}
