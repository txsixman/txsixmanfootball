"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountLink } from "./account-link";

export type NavSection = { href: string; label: string };

/** The header's section links. The section the reader is in (its own page or any page under it) is marked for screen
 * readers with aria-current and drawn with an underline, so the mark is not color alone. */
export function MainNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto whitespace-nowrap pl-2 pr-8 text-[15px] font-semibold [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:w-auto sm:overflow-visible sm:p-0 sm:text-sm sm:[mask-image:none]"
    >
      {sections.map((s) => {
        const here = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={here ? "page" : undefined}
            className={`inline-flex min-h-11 items-center px-2 hover:text-white ${here ? "text-white underline decoration-red decoration-4 underline-offset-[10px]" : "text-white/85"}`}
          >
            {s.label}
          </Link>
        );
      })}
      <AccountLink />
    </nav>
  );
}
