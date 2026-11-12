import { NextResponse, type NextRequest } from "next/server";
import { adminUserId, authCookieOptions, fanSignIn, NEXT_COOKIE, safeNext, siteOrigin } from "@/lib/auth/config";
import { getProfile } from "@/lib/auth/profile";
import { createRequestClient } from "@/lib/auth/request-client";

// Where the emailed sign-in link and Google's return land. It trades the one-time `code` for a session: Supabase checks
// it against the PKCE verifier cookie this browser got when it asked, so the link only works in the browser that asked.
// Then it goes where sign-in was asked from, except that anyone without a profile (a new fan, or one who left sign-up
// unfinished) goes to /account/welcome first, which asks the age question. No address, code or token is logged.
export const dynamic = "force-dynamic";

const NO_STORE = "no-store, private";

export async function GET(request: NextRequest) {
  const origin = siteOrigin(request.headers.get("host"));
  const code = request.nextUrl.searchParams.get("code");
  const fail = () => {
    const res = NextResponse.redirect(new URL("/sign-in?error=link", origin));
    res.headers.set("Cache-Control", NO_STORE);
    return res;
  };
  if (!code || request.nextUrl.searchParams.has("error")) return fail();

  const cookiesToSet: Parameters<Parameters<typeof createRequestClient>[1]>[0] = [];
  const supabase = createRequestClient(request, (list) => {
    for (const c of list) cookiesToSet.push(c);
  });
  if (!supabase) return fail();
  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail();

  const next = safeNext(request.cookies.get(NEXT_COOKIE)?.value);
  let destination = next;
  try {
    // Fan accounts off: the emailed link is the admin's way in and goes straight to where it was asked from. The admin
    // is never sent to fan sign-up.
    const isAdmin = exchanged.user?.id.toLowerCase() === adminUserId();
    if (fanSignIn() && !isAdmin && !(await getProfile(supabase))) {
      destination = `/account/welcome?next=${encodeURIComponent(next)}`;
    }
  } catch {
    // Could not ask: go on. Every page that needs a profile asks again, and the header sends a fan without one to sign-up.
  }
  const response = NextResponse.redirect(new URL(destination, origin));
  response.headers.set("Cache-Control", NO_STORE);
  for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
  response.cookies.set(NEXT_COOKIE, "", { ...authCookieOptions(), path: "/auth", maxAge: 0 });
  return response;
}
