"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authCookieOptions, authEnv, emailMayCreateUsers, fanSignIn, NEXT_COOKIE, safeNext, siteOrigin } from "@/lib/auth/config";
import { createAuthClient } from "@/lib/auth/server";

// Sign-in by emailed link (Supabase Auth, PKCE). Nothing here logs an email address, a token or a Supabase error: those
// can name the person or the request. The answer never says whether an address has an account.

export type SignInState = { sent?: boolean; error?: string };

const Email = z.email().max(254);

export async function sendSignInLink(_previous: SignInState, data: FormData): Promise<SignInState> {
  if (!authEnv()) return { error: "Sign-in is not available yet." };
  const email = Email.safeParse(typeof data.get("email") === "string" ? (data.get("email") as string).trim() : "");
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await createAuthClient();
  if (!supabase) return { error: "Sign-in is not available yet." };

  const store = await cookies();
  store.set(NEXT_COOKIE, safeNext(data.get("next")), { ...authCookieOptions(), path: "/auth", maxAge: 60 * 15 });

  const origin = siteOrigin((await headers()).get("host"));
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    // A new account by email only when FAN_SIGNIN and FAN_EMAIL_SIGNIN are both "on" (the second after the project's own
    // email sender works). Otherwise an existing user (the admin) still gets a link and a stranger gets none. A new account lands on /account/welcome
    // (age gate) before anything else: the callback sends every signed-in person without a profile there.
    options: { shouldCreateUser: emailMayCreateUsers(), emailRedirectTo: `${origin}/auth/callback` },
  });
  // An unknown address and a known one look the same. Supabase answers an address it will not mail with a 4xx (and a 429
  // when one address is asked too often), and a 429 would tell a caller which addresses are real, so every outcome that is
  // not a server failure (5xx) says "sent". Only a 5xx, which is about Supabase and not the address, says it failed.
  if (error && (error.status ?? 0) >= 500) return { error: "Could not send a link right now. Try again in a minute." };
  return { sent: true };
}

/** "Continue with Google": sends the browser to Google, which returns to /auth/callback with the same kind of one-time code. Behind FAN_SIGNIN only, never FAN_EMAIL_SIGNIN. */
export async function signInWithGoogle(data: FormData): Promise<void> {
  if (!fanSignIn()) redirect("/sign-in"); // fan accounts are off: no Google
  const env = authEnv();
  const supabase = await createAuthClient();
  if (!env || !supabase) redirect("/sign-in?error=unavailable");

  const store = await cookies();
  store.set(NEXT_COOKIE, safeNext(data.get("next")), { ...authCookieOptions(), path: "/auth", maxAge: 60 * 15 });
  const origin = siteOrigin((await headers()).get("host"));
  const { data: started, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  // Only ever go where the Supabase project says (its own /auth/v1/authorize address), whatever came back.
  if (error || !started.url || new URL(started.url).origin !== new URL(env.url).origin) redirect("/sign-in?error=unavailable");
  redirect(started.url);
}

/** Ends this browser's session (Supabase revokes its refresh token) and clears the cookies. Other devices stay signed in. */
export async function signOut(): Promise<void> {
  const supabase = await createAuthClient();
  // scope "local": only this browser's session ends. (The default, "global", would sign the admin out everywhere.)
  await supabase?.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}
