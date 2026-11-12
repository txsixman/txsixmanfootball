import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Offline | Project 80x40" };

/** What the service worker (app/sw.ts) shows for a page that is not saved on this phone, or is too old to show. */
export default function Offline() {
  return (
    <section aria-labelledby="offline">
      <h1 id="offline" className="font-num text-[56px] font-bold uppercase leading-none tracking-wide text-navy">
        Offline
      </h1>
      <p className="mt-3 max-w-prose text-[16px] text-ink">
        This page is not saved on this device, or its scores are too old to show. Pages you have opened lately still
        work. Scores come back when you are online again.
      </p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-navy underline">
        Home
      </Link>
    </section>
  );
}
