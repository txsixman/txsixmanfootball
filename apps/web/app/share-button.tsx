"use client";

import { Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Share" for the page it sits on. Uses the phone's share sheet when the browser has one; otherwise copies the page's
 * address and says so in a polite live region for a couple of seconds. A share the visitor cancels is not an error, and
 * when neither works the button does nothing. The address is the page's own location, so no host is written here.
 */
export function ShareButton({ title, className }: { title: string; className?: string }) {
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function share() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // the visitor closed the share sheet
      // Any other failure: fall through to copying the link.
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNote(""), 3000);
    } catch {
      // No clipboard (an insecure page or a blocked permission): nothing more to try.
    }
  }

  return (
    <div data-pagefind-ignore className={className}>
      <Button type="button" variant="outline" onClick={share}>
        <Share2 aria-hidden="true" />
        Share
      </Button>
      <p role="status" className="mt-1 min-h-5 text-[14px] text-ink">
        {note}
      </p>
    </div>
  );
}
