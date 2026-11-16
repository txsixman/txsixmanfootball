"use client";

import { useEffect, useId, useRef, useState } from "react";
import { onThisBrowserChange, turnOffHere, turnOnHere } from "@/app/account/this-browser";
import { fetchMe } from "@/lib/account/follows";
import { followedHere, pushSupported, stopHere, subscribeHere, thisBrowserSubscribed } from "@/lib/push";

type Phase = "loading" | "hidden" | "ios" | "ready";

const BAD = "That did not work. Check your connection and try again.";

/** An iPhone or iPad whose browser tab (not the Home Screen app) is open: iOS shows web push only to a site added to the Home Screen. An iPad can report a Mac. */
function iosNeedsHomeScreen(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

/**
 * Game alerts on this device (ADR 0082): kickoff, final score and the next playoff game for the teams followed. Shown only when the site
 * switch says so (/api/push/status, FAN_PUSH_ALERTS); off, it renders nothing, so no page changes. The browser's permission is asked
 * only from the tap, never on load. Signed in, it links this browser to the account and turns it off through the account's own path
 * (app/account/this-browser.ts); signed out, it follows this browser's own list of programs and keeps that list when turned off.
 */
export function AlertsToggle() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [note, setNote] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const working = useRef(false);
  const helpId = useId();

  useEffect(() => {
    let live = true;
    const reread = () => {
      if (!working.current) void thisBrowserSubscribed().then((now) => live && !working.current && setOn(now));
    };
    void (async () => {
      const status = await fetch("/api/push/status", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
        .then((res) => (res.ok ? (res.json() as Promise<{ alerts?: boolean }>) : undefined))
        .catch(() => undefined);
      if (!live || status?.alerts !== true) return setPhase("hidden");
      if (!pushSupported()) return setPhase(iosNeedsHomeScreen() ? "ios" : "hidden");
      const [subscribed, me] = await Promise.all([thisBrowserSubscribed(), fetchMe()]);
      if (!live) return;
      setSignedIn(me?.me != null && me.me.displayName !== null);
      setOn(subscribed);
      setBlocked(Notification.permission === "denied");
      setPhase("ready");
    })();
    const stop = onThisBrowserChange(reread);
    return () => {
      live = false;
      stop();
    };
  }, []);

  /** The tap. The permission prompt is asked first, straight from the tap, before anything else is awaited. */
  async function toggle() {
    if (working.current) return;
    const turnOn = !on;
    working.current = true;
    setBusy(true);
    setNote("");
    try {
      if (turnOn && Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") {
        setBlocked(true);
        return;
      }
      if (turnOn) {
        if (signedIn) {
          const result = await turnOnHere();
          if (result === "blocked") return setBlocked(true);
          if (result !== "ok") return setNote(BAD);
        } else await subscribeHere(followedHere());
      } else if (signedIn) {
        if ((await turnOffHere()) !== "ok") return setNote(BAD);
      } else await stopHere();
      setBlocked(false);
      setOn(turnOn);
      setNote(turnOn ? "Game alerts are on for this device." : "Game alerts are off for this device.");
    } catch (e) {
      const why = (e as Error).message;
      if (why === "permission") setBlocked(true);
      else setNote(why === "nothing followed" ? "Follow a team first, then turn on game alerts." : BAD);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (phase === "loading" || phase === "hidden") return null;
  if (phase === "ios") {
    return (
      <p data-testid="alerts-ios-note" data-pagefind-ignore className="mt-2 max-w-prose text-[14px] text-muted">
        On iPhone or iPad, add this site to your Home Screen first (Share, then Add to Home Screen), then open it from there to turn on alerts.
      </p>
    );
  }
  return (
    <div data-pagefind-ignore className="mt-2 max-w-prose">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={helpId}
        aria-busy={busy}
        data-testid="alerts-toggle"
        onClick={toggle}
        className="flex min-h-11 w-full items-center gap-3 text-left text-[15px] font-semibold text-ink aria-busy:opacity-60"
      >
        <span aria-hidden="true" className={`relative inline-block h-6 w-11 shrink-0 rounded-full border border-navy transition-colors ${on ? "bg-band text-white" : "bg-page text-navy"}`}>
          <span className={`absolute left-[3px] top-[3px] size-4 rounded-full transition-transform bg-current ${on ? "translate-x-5" : ""}`} />
        </span>
        Game alerts on this device
      </button>
      <p id={helpId} className="text-[13px] text-muted">
        Kickoff, final score and the next playoff game for the teams you follow.
      </p>
      <div role="status" className="text-[14px] text-ink">
        {blocked && (
          <p data-testid="alerts-blocked" className="mt-1 font-semibold">
            Alerts are blocked for this site in your browser&apos;s settings.
          </p>
        )}
        {note && <p className="mt-1">{note}</p>}
      </div>
    </div>
  );
}
