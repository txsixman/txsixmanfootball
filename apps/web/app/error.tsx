"use client";

import Link from "next/link";

// A page that failed while it was drawn in the browser (every page is built ahead, so this is rare: a bad cached copy or
// a script error). The header and footer stay; the visitor can try again or go home. The error itself is not shown.
// The button is a plain <button> with the classes components/ui/button.tsx gives its default variant (and h-11): this boundary
// loads on every page, and the Button component would bring tailwind-merge, cva and Slot (about 10 KB sent) with it (ADR 0080).
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section aria-labelledby="page-error">
      <p className="text-[12px] font-bold uppercase tracking-widest text-red">Something went wrong</p>
      <h1 id="page-error" className="mt-0.5 font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">
        This page did not load
      </h1>
      <p className="mt-2 max-w-prose text-[14px] leading-5 text-muted">Try it again. If it still does not load, start from the home page.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          data-slot="button"
          className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap text-[15px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 px-4 h-11"
          onClick={() => reset()}
        >
          Try again
        </button>
        <Link href="/" className="flex min-h-11 items-center border border-line px-4 text-[15px] font-semibold text-navy hover:bg-band hover:text-white">
          Home
        </Link>
      </div>
    </section>
  );
}
