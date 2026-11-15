import { NextResponse, type NextRequest } from "next/server";
import { authEnv } from "@/lib/auth/config";
import { unsubscribeSecret } from "@/lib/email/config";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

// One-click unsubscribe (RFC 8058, ADR 0053). Every email names this address in List-Unsubscribe with
// List-Unsubscribe-Post: List-Unsubscribe=One-Click, so a mail app POSTs here with no session and no cookie; the link in the
// email body opens the confirm page, whose button POSTs here too. The link's own signature (lib/email/unsubscribe.ts) is the
// proof: nothing else is asked, and nothing is read from a session. A GET changes nothing (mail scanners open links): it
// sends a person to the confirm page.
//
// The answer never says whose address this was or whether anything was switched off: a good signature always answers the same,
// so repeating it, or trying other ids, learns nothing. A bad signature answers 400 whatever the id is. The database function
// (email_unsubscribe, migration 0022) is called as the anonymous role with the public key, as every call from this site is;
// there is no service key. Nothing is logged: no address is here to log, and no id or error text either.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export function GET(request: NextRequest) {
  const to = new URL("/account/email/unsubscribe", request.nextUrl.origin);
  to.search = request.nextUrl.search;
  return NextResponse.redirect(to, { status: 303, headers });
}

export async function POST(request: NextRequest) {
  const secret = unsubscribeSecret();
  const env = authEnv();
  // Not set up here: fail closed, and let the mail app retry later.
  if (!secret || !env) return reply({ ok: false }, 503);
  const q = request.nextUrl.searchParams;
  const link = verifyUnsubscribe(secret, q.get("u"), q.get("k"), q.get("s"));
  if (!link) return reply({ ok: false }, 400);
  let done = false;
  try {
    const res = await fetch(`${env.url.replace(/\/$/, "")}/rest/v1/rpc/email_unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
      body: JSON.stringify({ p_user: link.userId, p_kind: link.kind }),
      signal: AbortSignal.timeout(8_000),
    });
    done = res.ok;
  } catch {
    // Unreachable: answered below as unavailable.
  }
  if (!done) return reply({ ok: false }, 503);
  // A browser (the confirm page's button) goes on to a page; a mail app gets a plain 200.
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL("/account/email/unsubscribed", request.nextUrl.origin), { status: 303, headers });
  }
  return reply({ ok: true });
}
