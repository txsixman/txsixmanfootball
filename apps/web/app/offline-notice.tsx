"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Registers the service worker (sw.ts, built to public/sw.js) in production builds; says so when the device is offline. */
export function Offline({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("service worker not registered:", e));
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
        <p role="status" className="bg-ink px-4 py-2 text-center text-[14px] font-semibold text-white">
          You are offline. These are saved pages; scores may be out of date.
        </p>
      )}
      {children}
    </>
  );
}
