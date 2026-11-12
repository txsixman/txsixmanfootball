import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminUserId, fanSignIn, safeNext } from "@/lib/auth/config";
import { getProfile } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { LegalLinks } from "../../legal-links";
import { WelcomeForm } from "./form";

// The last step of sign-up, and where anyone signed in without a profile is sent first. Per request, never cached.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finish sign-up | Project 80x40", robots: { index: false, follow: false } };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fanSignIn()) redirect("/"); // fan accounts are off
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const found = await getUser();
  if (!found) redirect(`/sign-in?next=${encodeURIComponent("/account/welcome")}`);
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin"); // the admin has no part in fan flows
  if (await getProfile(found.supabase)) redirect(next);
  return (
    <section aria-labelledby="welcome" className="max-w-prose">
      <h1 id="welcome" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Finish sign-up</h1>
      <p className="mt-2 text-[15px] text-muted">Pick a display name and give your birth year. That is all we ask.</p>
      <WelcomeForm next={next} />
      <p className="mt-4 max-w-sm text-[13px] leading-5 text-muted">
        By finishing you agree to the terms and the privacy page. You must be 13 or older. Your birth year is kept only to check your age and is never shown.
      </p>
      <LegalLinks />
    </section>
  );
}
