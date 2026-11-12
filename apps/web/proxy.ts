import { NextResponse, type NextRequest } from "next/server";
import { createRequestClient } from "@/lib/auth/request-client";

// Runs only for the pages that touch a session: the admin console, sign-in, the auth callback, fan accounts, the forums, the
// signed-in posting API (/api/fan) and the two small routes the pages' scripts call (/api/me, /api/follows; the service
// worker never keeps /api/ either). The public comment reads (/api/games/<id>/comments) use no session and set their own headers.
// It refreshes an expiring session before the page renders (a server component cannot set cookies) and puts the cache
// and robots headers on every response, so nothing here is stored by a shared cache, a browser's back cache, or a search
// engine. Keep this list in step with lib/never-cached.ts (the service worker's) and the doc.
export async function proxy(request: NextRequest) {
  const fresh = () => {
    const res = NextResponse.next({ request });
    res.headers.set("Cache-Control", "no-store, private");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };
  let response = fresh();
  const supabase = createRequestClient(request, (cookies) => {
    for (const { name, value } of cookies) request.cookies.set(name, value);
    response = fresh();
    for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
  });
  // Only a request that carries a session cookie has anything to refresh (and nothing here reads the answer: pages ask again).
  if (supabase && request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/sign-in", "/auth/:path*", "/account", "/account/:path*", "/forums", "/forums/:path*", "/api/me", "/api/follows", "/api/fan/:path*"],
};
