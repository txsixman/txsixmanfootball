"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BACK_ONLINE, OFFLINE_NOTICE, savedCopyNotice } from "@/lib/saved-copy";
import { askSavedCopy, setOnline, setSavedCopy, useOnline, useSavedCopy } from "@/lib/saved-copy-state";

// Registers the service worker (sw.ts, built to public/sw.js) in production builds, and says so when the page on screen is a saved
// copy of one the worker kept (ADR 0096): "Saved copy from 7:42 PM. You're offline; scores may have changed." in a bar fixed to the
// foot of the screen, a fixed height, so it moves nothing. A saved copy shows no live score and asks for none (lib/saved-copy-state.ts);
// it tries again when the signal returns (and every 20 seconds, and on "Try again"), and when the network answers it loads the page
// again and says "Back online — updated".
const BAR = "fixed inset-x-0 bottom-0 z-40 flex h-14 items-center gap-3 bg-band px-4 text-[14px] font-semibold leading-[18px] text-white shadow-[0_-2px_8px_rgba(0,0,0,0.25)]";
const RELOADED = "tx6-reloaded-for-updates";
const RETRY_EVERY_MS = 20_000;
/** An automatic reload waits this long after the last one, so a flaky signal never reloads the page again and again. */
const RELOAD_GAP_MS = 60_000;

const stamp = (key: string): number => {
  try {
    return Number(sessionStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};

export function Offline({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const saved = useSavedCopy();
  const online = useOnline();
  const [updated, setUpdated] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // Registering starts the worker's install, which fetches every script and style the site has (about 320 KB). Done
      // while the page is still loading, that fought the page's own images for a weak signal; so it waits until the page
      // has loaded and the phone is idle (ADR 0080).
      const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("service worker not registered:", e));
      const whenIdle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(register, { timeout: 4000 }) : setTimeout(register, 2000));
      if (document.readyState === "complete") whenIdle();
      else window.addEventListener("load", whenIdle, { once: true });
      return () => window.removeEventListener("load", whenIdle);
    }
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  // On every page (and every followed link), ask the worker whether what is on screen is a saved copy, and from when.
  useEffect(() => {
    let current = true;
    void askSavedCopy(pathname).then((at) => {
      if (!current) return;
      setSavedCopy(at);
      // A fresh page right after a reload made because the network came back: say so for a few seconds.
      if (at === null && Date.now() - stamp(RELOADED) < 2 * 60_000) {
        try {
          sessionStorage.removeItem(RELOADED);
        } catch {
          // Private browsing: the message is skipped, the page is still fresh.
        }
        setUpdated(true);
      }
    });
    return () => {
      current = false;
    };
  }, [pathname]);
  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setUpdated(false), 6_000);
    return () => clearTimeout(timer);
  }, [updated]);

  // Does the network answer? The manifest is tiny and the worker leaves it to the network. If so, load this page again: the
  // worker then fetches it fresh (and falls back to the saved copy again if that is slow, which the notice says).
  const inFlight = useRef(false);
  const retry = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    if (!manual) {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (document.visibilityState !== "visible" || typing || Date.now() - stamp(RELOADED) < RELOAD_GAP_MS) return;
    }
    inFlight.current = true;
    setChecking(true);
    try {
      const res = await fetch("/manifest.webmanifest", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        try {
          sessionStorage.setItem(RELOADED, String(Date.now()));
        } catch {
          // Private browsing: the page still reloads.
        }
        location.reload();
        return;
      }
    } catch {
      // Still no signal: the saved copy stays, and the notice with it.
    }
    inFlight.current = false;
    setChecking(false);
  }, []);
  const isSaved = saved !== null;
  useEffect(() => {
    if (!isSaved) return;
    const again = () => void retry(false);
    const timer = setInterval(again, RETRY_EVERY_MS);
    window.addEventListener("online", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", again);
    };
  }, [isSaved, retry]);

  const kind = saved ? "saved" : !online ? "offline" : updated ? "updated" : null;
  return (
    <>
      {children}
      {kind && (
        <>
          <div role="status" data-saved-notice={kind} className={BAR}>
            <span className="min-w-0 flex-1">
              {kind === "saved" ? savedCopyNotice({ savedAt: saved!.savedAt, now: Date.now(), online }) : kind === "offline" ? OFFLINE_NOTICE : BACK_ONLINE}
            </span>
            {kind === "saved" && (
              <button type="button" onClick={() => void retry(true)} disabled={checking} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-2 border-white px-3 text-[14px] font-bold">
                {checking ? "Checking..." : "Try again"}
              </button>
            )}
          </div>
          {/* The bar covers the foot of the screen; this holds the same room at the end of the page so the footer's links stay reachable. */}
          <div aria-hidden="true" className="h-14" />
        </>
      )}
    </>
  );
}
