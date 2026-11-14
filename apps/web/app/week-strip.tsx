"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

export type WeekLink = { number: number; href: string; label: string; current: boolean };

/** The week picker of results, weeks in review and weekly rankings. On a phone it is one row that scrolls sideways, opened
 * with the chosen week in view, instead of three rows of buttons above the games; from `sm` up it wraps as before. Every
 * week stays a plain link. `after`: one more link at the row's end (the weekly rankings' "latest"). */
export function WeekStrip({ weeks, prefetch, after }: { weeks: WeekLink[]; prefetch?: boolean; after?: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = nav.current;
    const chosen = strip?.querySelector<HTMLElement>("[aria-current=page]");
    if (!strip || !chosen) return;
    // Scroll the strip alone (never the page) so the chosen week sits in the middle.
    strip.scrollLeft = chosen.offsetLeft - strip.offsetLeft - (strip.clientWidth - chosen.offsetWidth) / 2;
  }, []);
  return (
    <nav
      ref={nav}
      aria-label="Week"
      className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-2rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none]"
    >
      {weeks.map((w) => (
        <Link
          key={w.number}
          href={w.href}
          prefetch={prefetch}
          aria-current={w.current ? "page" : undefined}
          aria-label={w.label}
          className={`inline-flex size-11 shrink-0 items-center justify-center border-2 border-navy font-num text-[17px] font-bold ${
            w.current ? "bg-navy text-white" : "text-navy hover:bg-panel"
          }`}
        >
          {w.number}
        </Link>
      ))}
      {after}
    </nav>
  );
}
