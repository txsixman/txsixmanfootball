"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WELCOME_SEEN } from "@/lib/welcome";

const remember = () => {
  try {
    localStorage.setItem(WELCOME_SEEN, "1");
  } catch {
    // Private mode: the link may show again on a later visit.
  }
};

/**
 * The home page's "New here?" link to /welcome (ADR 0084), for a first visit only. It is drawn with the page, and the inline
 * script before it (NEW_HERE_SCRIPT in lib/welcome.ts) hides it before it paints for a browser that has been here before, so
 * nothing moves. Dismissed, it is gone for good on this browser.
 */
export function NewHere() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <p className="mt-3 flex max-w-prose items-center border-l-4 border-red bg-panel pl-3 [[data-returning]_&]:hidden">
      <Link href="/welcome" onClick={remember} className="inline-flex min-h-11 flex-1 items-center text-[15px] font-semibold text-navy underline underline-offset-2">
        New here? Start here
      </Link>
      <button
        type="button"
        onClick={() => {
          remember();
          setGone(true);
        }}
        aria-label="Hide the New here link"
        className="inline-flex size-11 shrink-0 items-center justify-center text-muted hover:text-ink"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </p>
  );
}
