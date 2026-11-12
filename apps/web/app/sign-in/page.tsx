import type { Metadata } from "next";
import { authEnv, fanEmailSignIn, fanSignIn, safeNext } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { signInWithGoogle } from "./actions";
import { SignOutButton } from "../account/sign-out-button";
import { SignInForm } from "./sign-in-form";
import { Button } from "@/components/ui/button";
import { LegalLinks } from "../legal-links";

// Per request, never cached or indexed: it reads the visitor's session.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | Project 80x40", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  link: "That link did not work. It may have expired or been used already. Ask for a new one.",
  unavailable: "Sign-in is not available right now. Try again in a minute.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const key = typeof params.error === "string" ? params.error : undefined;
  const error = key === undefined ? (params.error !== undefined ? ERRORS.link : null) : Object.hasOwn(ERRORS, key) ? ERRORS[key] : ERRORS.link;
  const who = await getUser();
  const fans = fanSignIn();
  const open = fans && fanEmailSignIn();
  return (
    <section aria-labelledby="sign-in" className="max-w-prose">
      <h1 id="sign-in" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">
        Sign in
      </h1>
      {error && <p className="mt-3 text-[14px] font-semibold text-red" role="alert">{error}</p>}
      {params.deleted !== undefined && <p className="mt-3 text-[14px] text-ink" role="status">Your account is deleted.</p>}
      {who ? (
        <div className="mt-5">
          <p className="mb-3 text-[15px] text-ink">You are signed in.</p>
          <SignOutButton />
        </div>
      ) : !fans ? (
        // Fan accounts are off (FAN_SIGNIN): only the email link, for accounts that already exist (the admin's way in).
        <>
          <p className="mt-2 text-[15px] text-muted">We email you a link. No password.</p>
          <SignInForm next={next} />
        </>
      ) : (
        <>
          {authEnv() && (
            <form action={signInWithGoogle} className="mt-5 max-w-sm">
              <input type="hidden" name="next" value={next} />
              <Button type="submit" className="w-full">Continue with Google</Button>
            </form>
          )}
          {open ? (
            <>
              <p className="mt-5 text-[15px] text-muted">Or we email you a link. No password. New here? The same link makes your account.</p>
              <SignInForm next={next} />
            </>
          ) : (
            // Until the project's own email sender works the email link is for existing accounts only (FAN_EMAIL_SIGNIN).
            <details className="mt-5 max-w-sm">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-[15px] text-navy underline">I already have an account: email me a link</summary>
              <SignInForm next={next} />
            </details>
          )}
          <p className="mt-4 max-w-sm text-[13px] leading-5 text-muted">
            You must be 13 or older. New accounts pick a display name and give a birth year, which is never shown. By continuing you agree to the terms and the privacy page.
          </p>
          <LegalLinks />
        </>
      )}
    </section>
  );
}
