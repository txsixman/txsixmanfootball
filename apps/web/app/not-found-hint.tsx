"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { lostWords } from "@/lib/lost";

// On the 404 page: when the address looks like a school, a game or a series, offer the search with its words already typed
// (the search lands on its closest name, "Did you mean"), and the Programs list, which is every school by name. Drawn with the
// page on the server (the path is known there), so nothing moves after load.
const link = "inline-flex min-h-11 items-center border-2 border-navy px-4 text-[15px] font-semibold text-navy hover:bg-panel";

export function NotFoundHint() {
  const words = lostWords(usePathname() ?? "");
  if (!words) return null;
  return (
    <div className="mt-6 max-w-md" data-testid="lost-hint">
      <p className="text-[15px] text-ink">
        Looking for <strong>{words}</strong>?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={`/search?q=${encodeURIComponent(words)}`} prefetch={false} className={link}>
          Search for &ldquo;{words}&rdquo;
        </Link>
        <Link href="/programs" prefetch={false} className={link}>
          Every program by name
        </Link>
      </div>
    </div>
  );
}
