"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// A page that failed while it was drawn in the browser (every page is built ahead, so this is rare: a bad cached copy or
// a script error). The header and footer stay; the visitor can try again or go home. The error itself is not shown.
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="page-error">
      <p className="text-[12px] font-bold uppercase tracking-widest text-red">Something went wrong</p>
      <h1 id="page-error" className="mt-0.5 font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">
        This page did not load
      </h1>
      <p className="mt-2 max-w-prose text-[14px] leading-5 text-muted">Try it again. If it still does not load, start from the home page.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" className="h-11" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/" className="flex min-h-11 items-center border border-line px-4 text-[15px] font-semibold text-navy hover:bg-band hover:text-white">
          Home
        </Link>
      </div>
    </section>
  );
}
