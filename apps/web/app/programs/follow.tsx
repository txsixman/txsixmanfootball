"use client";

import { Bell, BellOff, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { changeAccountFollows, fetchMe, type Me } from "@/lib/account/follows";
import { followedHere, pushSupported, setFollow } from "@/lib/push";

type State = "loading" | "unsupported" | "off" | "on" | "busy";

/**
 * Follow one program. Signed out: "Alert me to finals", a browser push alert when a new final score of theirs is read,
 * remembered on this browser (as it always was). Signed in: the same button also follows on the account (My teams on every
 * device), and where this browser cannot show alerts it still follows on the account. Push alerts stay per browser.
 */
export function Follow({ slug, school }: { slug: string; school: string }) {
  const [state, setState] = useState<State>("loading");
  const [note, setNote] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [enabled, setEnabled] = useState(false); // fan accounts on (FAN_SIGNIN): else this is the browser-only button as ever
  // Whether this browser can show alerts, kept apart from `state`: once signed in, `state` holds on/off for the account.
  const [canPush, setCanPush] = useState(true);
  const signedIn = me !== null && me.displayName !== null;

  useEffect(() => {
    const supported = pushSupported();
    setCanPush(supported);
    const here = supported && followedHere().includes(slug);
    if (!supported) setState("unsupported");
    else setState(here ? "on" : "off");
    let live = true;
    void fetchMe().then((a) => {
      const answer = a?.me;
      if (live && a?.enabled) setEnabled(true);
      if (!live || !answer || answer.displayName === null) return;
      setMe(answer);
      // Signed in: following on the account counts, and so does a browser that cannot show alerts.
      setState(here || answer.follows.includes(slug) ? "on" : "off");
    });
    return () => {
      live = false;
    };
  }, [slug]);

  async function toggle() {
    const turnOn = state === "off";
    const before = state;
    setState("busy");
    setNote("");
    if (signedIn) {
      try {
        await changeAccountFollows({ op: turnOn ? "follow" : "unfollow", slug });
      } catch (e) {
        setState(before);
        setNote((e as Error).message === "limit" ? "An account follows at most 100 teams. Unfollow one first." : "That did not work. Check your connection and try again.");
        return;
      }
    }
    if (!canPush) {
      setState(turnOn ? "on" : "off");
      setNote(turnOn ? `Following ${school}.` : `Unfollowed ${school}.`);
      return;
    }
    try {
      await setFollow(slug, turnOn);
      setState(turnOn ? "on" : "off");
      setNote(signedIn ? (turnOn ? `Following ${school}. You will get its final scores as alerts on this browser.` : `Unfollowed ${school}.`) : turnOn ? `Alerts on: you will get ${school}'s final scores.` : `Alerts off for ${school}.`);
    } catch (e) {
      const blocked = (e as Error).message === "permission";
      if (signedIn) {
        // The account change went through; only the browser's alerts did not.
        setState(turnOn ? "on" : "off");
        setNote(blocked ? `${turnOn ? "Following" : "Unfollowed"} ${school}. Notifications are blocked for this site, so no alerts here. Allow them in your browser's site settings to get them.` : `${turnOn ? "Following" : "Unfollowed"} ${school}, but alerts on this browser did not change. Try again.`);
      } else {
        setState(turnOn ? "off" : "on");
        setNote(blocked ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : "That did not work. Check your connection and try again.");
      }
    }
  }

  // Rendered on the server too, with the button off until this browser is checked: a section that appeared only after
  // the page's script ran was its largest late paint (Lighthouse LCP 3.2 s on phone). Kept out of the search index.
  const on = state === "on";
  return (
    <section aria-labelledby="alerts" data-pagefind-ignore className="mt-6 px-3">
      <h2 id="alerts" className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">
        {signedIn ? "Follow" : "Score alerts"}
      </h2>
      {state === "unsupported" && !signedIn ? (
        <p className="mt-1 text-[14px] text-muted">
          This browser cannot show alerts. On an iPhone, add this site to your Home Screen first, then open it from there.
        </p>
      ) : (
        <>
          <Button type="button" variant="outline" onClick={toggle} disabled={state === "busy" || state === "loading"} aria-pressed={on} className="mt-2 max-w-full whitespace-normal py-1.5 text-left">
            {signedIn ? <Star aria-hidden="true" className={on ? "fill-current" : ""} /> : on ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {signedIn ? (on ? `Unfollow ${school}` : `Follow ${school}`) : on ? "Stop alerts" : `Alert me to ${school} finals`}
          </Button>
          <p role="status" className="mt-1 text-[14px] text-ink">
            {note}
          </p>
        </>
      )}
      {signedIn ? (
        <p className="mt-1 text-[13px] text-muted">
          Stored: the programs you follow, on your account. Alerts, where this browser can show them, use only this browser&apos;s push address.
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-muted">
          Stored: only this browser&apos;s push address and the programs you follow; no name, email or phone. To stop, tap
          Stop alerts or block notifications for this site.{" "}
          {enabled && (
            <Link href={`/sign-in?next=${encodeURIComponent(`/programs/${slug}`)}`} className="inline-flex min-h-11 items-center text-navy underline hover:no-underline">
              Sign in to follow on every device
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
