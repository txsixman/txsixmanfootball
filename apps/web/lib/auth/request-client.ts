import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { authCookieOptions, authEnv, hardenCookie } from "./config";

type Cookie = { name: string; value: string; options: Parameters<typeof hardenCookie>[0] };

/**
 * A Supabase client for code that has the whole request and builds its own response (the proxy, the sign-in callback).
 * Cookies it wants set come to `onSet`, with the safety flags already laid on (config.ts); the caller puts them on the
 * response it returns. One client per request: never share one.
 */
export function createRequestClient(request: NextRequest, onSet: (cookies: Cookie[]) => void) {
  const env = authEnv();
  if (!env) return null;
  return createServerClient(env.url, env.anonKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => onSet(list.map(({ name, value, options }) => ({ name, value, options: hardenCookie(options) }))),
    },
  });
}
