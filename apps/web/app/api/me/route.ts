import { NextResponse, type NextRequest } from "next/server";
import { adminUserId, fanPosts, fanSignIn, siteOrigin } from "@/lib/auth/config";
import { getFollows, getProfile } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { logDbFailure } from "@/lib/log-db";

// Who is signed in, for the page's own script (the auth cookies are httpOnly): `{ enabled, posts, me }`. `enabled` is whether fan
// accounts are on (FAN_SIGNIN, read per request, so the header and Follow button need no rebuild); `posts` is whether forums,
// comments and score reports are on too (FAN_POSTS, ADR 0052; never true while `enabled` is false); `me` is null when nobody
// is signed in, else the display name (null until sign-up is finished), the programs the account follows, and `admin` when
// this is the admin. With fan accounts off Supabase is not asked at all, except when the request comes from an admin page.
// Never cached or indexed (proxy.ts sets the same headers). Nothing else leaves here: no email, no birth year, no id.
// A failure is logged as one line with no detail (lib/log-db.ts).
export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" } });

/** True when the page asking is one of this site's own admin pages. */
function fromAdminPage(request: NextRequest): boolean {
  try {
    const referer = new URL(request.headers.get("referer") ?? "");
    return referer.origin === siteOrigin(request.headers.get("host")) && /^\/admin(\/|$)/.test(referer.pathname);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const enabled = fanSignIn();
  const posts = fanPosts();
  if (!enabled && !fromAdminPage(request)) return reply({ enabled, posts, me: null });
  // No session cookie, nothing to ask Supabase: the common case answers at once.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return reply({ enabled, posts, me: null });
  try {
    const found = await getUser();
    if (!found) return reply({ enabled, posts, me: null });
    const profile = await getProfile(found.supabase);
    const admin = found.user.id.toLowerCase() === adminUserId();
    return reply({
      enabled,
      posts,
      me: { displayName: profile?.displayName ?? null, follows: profile ? await getFollows(found.supabase) : [], ...(admin && { admin: true }) },
    });
  } catch {
    logDbFailure("me", "my_profile or my_follows");
    return reply({ error: "unavailable" }, 503);
  }
}
