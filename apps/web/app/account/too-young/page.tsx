import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanSignIn } from "@/lib/auth/config";

export const metadata: Metadata = { title: "You must be 13 or older | Project 80x40", robots: { index: false, follow: false } };

// Read per request: with fan accounts off (FAN_SIGNIN) there is no such page.
export const dynamic = "force-dynamic";

export default function TooYoungPage() {
  if (!fanSignIn()) notFound();
  return (
    <section aria-labelledby="too-young" className="max-w-prose">
      <h1 id="too-young" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">You must be 13 or older</h1>
      <p className="mt-3 text-[15px] text-ink">
        Accounts are for people 13 and older, so we could not finish yours. Nothing about you was kept, and you are signed out.
      </p>
      <p className="mt-3 text-[15px] text-ink">
        You can still read every score, ranking and schedule on the site without an account.
      </p>
      <Link href="/" className="mt-3 inline-flex min-h-11 items-center text-navy underline hover:no-underline">Go to the home page</Link>
    </section>
  );
}
