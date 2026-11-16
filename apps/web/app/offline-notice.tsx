"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Registers the service worker (sw.ts, built to public/sw.js) in production builds; says so when the device is offline. */
export function Offline({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);
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
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <>
      {offline && (
        <p role="status" className="bg-band px-4 py-2 text-center text-[14px] font-semibold text-white">
          You are offline. These are saved pages; scores may be out of date.
        </p>
      )}
      {children}
    </>
  );
}
