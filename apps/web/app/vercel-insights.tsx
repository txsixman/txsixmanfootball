"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Their code (about 8 KB sent with the header's account link, in a script every page loaded with its first scripts) is its
// own chunk, fetched once the page has loaded and the phone is idle (up to 4 seconds), the way the service worker registers
// (offline-notice.tsx, ADR 0080). Both read what happened from the browser's own timeline, so the load times they report
// are the same; the visit's page view is sent when they start, not at the first paint (ADR 0100).
const Analytics = dynamic(() => import("@vercel/analytics/next").then((m) => m.Analytics), { ssr: false });
const SpeedInsights = dynamic(() => import("@vercel/speed-insights/next").then((m) => m.SpeedInsights), { ssr: false });

export function VercelInsights() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const go = () => setReady(true);
    const whenIdle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 2000));
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => window.removeEventListener("load", whenIdle);
  }, []);
  return ready ? (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  ) : null;
}
