"use client";

import { useState } from "react";
import { followedHere } from "@/lib/push";
import { nextGamesOf, planTonight, rememberSave, savedLine, savePages, type Saved } from "@/lib/save-tonight";
import { sizeText } from "@/lib/saved-copy";

/** "Save for no signal" (ADR 0096): keeps the scoreboard, this list, this round's bracket and the game page of each followed team's game
 * tonight on this phone, so they open at a field with no bars. Says what it kept and its size; a saved page says when it was saved. */
export function SaveForOffline() {
  const [state, setState] = useState<"idle" | "saving" | "failed" | Saved>("idle");
  async function save() {
    setState("saving");
    const { urls } = planTonight(await nextGamesOf(followedHere()));
    const saved = await savePages(urls);
    if (saved?.pages) rememberSave(urls, saved);
    setState(saved?.pages ? saved : "failed");
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        className="inline-flex min-h-11 min-w-11 items-center border-2 border-navy px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel disabled:opacity-60"
      >
        {state === "saving" ? "Saving..." : "Save for no signal"}
      </button>
      <p className="mt-1 max-w-prose text-[13px] leading-5 text-muted">
        Keeps the scoreboard, this list, this round&rsquo;s bracket and your followed teams&rsquo; games tonight on this phone. Under 1 MB stored, about 100 KB downloaded.
      </p>
      <p role="status" className="min-h-5 text-[13px] leading-5 text-ink">
        {typeof state === "object" ? savedLine(state, sizeText) : state === "failed" ? "Could not save here. Open this page again once the site has loaded." : ""}
      </p>
    </div>
  );
}
