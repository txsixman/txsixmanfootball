"use client";

import { useEffect, useState } from "react";
import { recentSave, rememberSave, savedLine, savePages } from "@/lib/save-tonight";
import { sizeText } from "@/lib/saved-copy";

/**
 * On a followed team's game day, "My teams" saves tonight's pages on this phone for no signal (ADR 0096) and says what that
 * cost. The line holds its height from the first paint, so its words changing move nothing. Production only: that is where the
 * service worker runs.
 */
export function SavedTonight({ urls }: { urls: string[] }) {
  const [text, setText] = useState("Saving tonight's games for no signal...");
  const key = urls.join(" ");
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      setText("");
      return;
    }
    let current = true;
    const done = (saved: { pages: number; bytes: number } | null) => current && setText(saved?.pages ? savedLine(saved, sizeText) : "");
    // The followed teams arrive one by one; wait until the list has stopped growing, then save once.
    const timer = setTimeout(() => {
      const earlier = recentSave(urls);
      if (earlier) return done(earlier);
      void savePages(urls).then((saved) => {
        if (saved?.pages) rememberSave(urls, saved);
        done(saved);
      });
    }, 2_500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `urls` is rebuilt on every render; `key` says when it changed.
  }, [key]);
  return (
    <p data-saved-tonight className="mt-2 min-h-5 text-[13px] leading-5 text-muted">
      {text}
    </p>
  );
}
