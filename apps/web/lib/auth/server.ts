import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authCookieOptions, authEnv, hardenCookie } from "./config";

// The shared sign-in foundation: the admin console sits on it, fan accounts will too. Every Supabase call is made on the
// server with the visitor's own session cookie; nothing here reaches the browser.

/**
 * A Supabase client for a server component, server action or route handler, acting as the signed-in visitor (their
 * session cookie, the public anon key, never a service key). Null when sign-in is not configured.
 *
 * A server component cannot set cookies, so a token refresh it triggers is dropped here: proxy.ts refreshes the session
 * first, on every path that reads it, and writes the new cookies.
 */
export async function createAuthClient(): Promise<SupabaseClient | null> {
  const env = authEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, hardenCookie(options));
        } catch {
          // Called from a server component: proxy.ts already refreshed the session for this request.
        }
      },
    },
  });
}

/**
 * Who is signed in, verified by Supabase: getUser() asks the auth server to check the token. Never use getSession() for
 * this: it only reads the cookie, which a visitor can forge. Null when nobody is signed in, the token is not valid, or
 * sign-in is not configured.
 */
export async function getUser(client?: SupabaseClient | null): Promise<{ user: User; supabase: SupabaseClient } | null> {
  const supabase = client ?? (await createAuthClient());
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : { user: data.user, supabase };
}
