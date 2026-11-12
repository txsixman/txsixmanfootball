import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { adminUserId, fanSignIn, safeNext } from "@/lib/auth/config";
import { getProfile } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { LegalLinks } from "../legal-links";
import { DeleteAccount } from "./delete-account";
import { SignOutButton } from "./sign-out-button";
import { ImportFollows } from "./import-follows";

// Your account. Per request, never cached or indexed. It shows the display name and the date joined and nothing else: no
// email, age, birth year or school appears on this page or anywhere public.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

const joined = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Chicago" }).format(new Date(iso));

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fanSignIn()) redirect("/"); // fan accounts are off
  const params = await searchParams;
  const found = await getUser();
  if (!found) redirect("/sign-in?next=%2Faccount");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin"); // the admin has no part in fan flows
  const profile = await getProfile(found.supabase);
  if (!profile) redirect("/account/welcome?next=%2Faccount");
  const welcome = params.welcome !== undefined;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  return (
    <section aria-labelledby="account" className="max-w-prose">
      <h1 id="account" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Your account</h1>
      {welcome && (
        <p role="status" className="mt-3 text-[15px] text-ink">
          You are in. Follow teams from any program page.{" "}
          {next !== "/" && next !== "/account" && <Link href={next} className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Back to where you were</Link>}
        </p>
      )}
      <dl className="mt-4 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
        <dt className="text-muted">Display name</dt>
        <dd className="font-semibold text-ink">{profile.displayName}</dd>
        <dt className="text-muted">Joined</dt>
        <dd className="text-ink">{joined(profile.createdAt)}</dd>
      </dl>
      <p className="mt-2 max-w-sm text-[13px] leading-5 text-muted">Your display name is the only thing others can see. Your email and birth year are never shown.</p>
      <ImportFollows />
      <SignOutButton className="mt-6" />
      <h2 className="mt-8 font-num text-[20px] font-bold uppercase tracking-wide text-navy">Delete my account</h2>
      <p className="mt-1 max-w-sm text-[14px] text-muted">Erases your display name, follows and sign-in. Push alerts are per browser: stop them with Stop alerts on a program page.</p>
      <DeleteAccount />
      <LegalLinks className="mt-6" />
    </section>
  );
}
