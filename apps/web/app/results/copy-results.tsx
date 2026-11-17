"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Copy results" (ADR 0102): puts the week's plain text on the clipboard. The text is the print-only block of the page itself
 * (`from` is its id), so what is copied is exactly what is printed and what the text file holds. The answer ("Copied", or "Not copied", a short word so it never widens the button's column)
 * goes in a polite live region whose height is fixed, so nothing on the page moves when it appears or goes.
 */
export function CopyResults({ from }: { from: string }) {
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let said = "Copied";
    try {
      await navigator.clipboard.writeText(document.getElementById(from)?.textContent ?? "");
    } catch {
      said = "Not copied";
    }
    setNote(said);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(""), 3000);
  }

  return (
    <div>
      <Button type="button" variant="outline" onClick={copy}>
        <Copy aria-hidden="true" />
        Copy results
      </Button>
      <p role="status" data-copy-status className="h-6 overflow-hidden text-[14px] leading-6 text-ink">
        {note}
      </p>
    </div>
  );
}
