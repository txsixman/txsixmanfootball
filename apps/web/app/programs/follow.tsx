"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { followedHere, pushSupported, setFollow } from "@/lib/push";

/** "Alert me to finals" for one program: a browser push alert when a new final score of theirs is read. */
export function Follow({ slug, school }: { slug: string; school: string }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "busy">("loading");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!pushSupported()) setState("unsupported");
    else setState(followedHere().includes(slug) ? "on" : "off");
  }, [slug]);

  async function toggle() {
    const turnOn = state === "off";
    setState("busy");
    setNote("");
    try {
      await setFollow(slug, turnOn);
      setState(turnOn ? "on" : "off");
      setNote(turnOn ? `Alerts on: you will get ${school}'s final scores.` : `Alerts off for ${school}.`);
    } catch (e) {
      setState(turnOn ? "off" : "on");
      setNote(
        (e as Error).message === "permission"
          ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
          : "That did not work. Check your connection and try again.",
      );
    }
  }

  // Rendered on the server too, with the button off until this browser is checked: a section that appeared only after
  // the page's script ran was its largest late paint (Lighthouse LCP 3.2 s on phone). Kept out of the search index.
  return (
    <section aria-labelledby="alerts" data-pagefind-ignore className="mt-6 px-3">
      <h2 id="alerts" className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">
        Score alerts
      </h2>
      {state === "unsupported" ? (
        <p className="mt-1 text-[14px] text-muted">
          This browser cannot show alerts. On an iPhone, add this site to your Home Screen first, then open it from there.
        </p>
      ) : (
        <>
          <Button type="button" variant="outline" onClick={toggle} disabled={state === "busy" || state === "loading"} aria-pressed={state === "on"} className="mt-2">
            {state === "on" ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {state === "on" ? "Stop alerts" : `Alert me to ${school} finals`}
          </Button>
          <p role="status" className="mt-1 text-[14px] text-ink">
            {note}
          </p>
        </>
      )}
      <p className="mt-1 text-[13px] text-muted">
        Stored: only this browser&apos;s push address and the programs you follow; no name, email or phone. To stop, tap
        Stop alerts or block notifications for this site.
      </p>
    </section>
  );
}
