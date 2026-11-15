import type { Metadata } from "next";
import Link from "next/link";

// Where the unsubscribe page's button lands (ADR 0053). The same words whatever was switched off, and nothing about whose it was.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribed", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function UnsubscribedPage() {
  return (
    <section aria-labelledby="done" className="max-w-prose">
      <h1 id="done" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Unsubscribed</h1>
      <p role="status" className="mt-4 max-w-sm text-[15px] text-ink">You will not get these emails. You can turn them back on from your account page.</p>
      <p className="mt-3">
        <Link href="/account" className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">Your account</Link>
      </p>
    </section>
  );
}
