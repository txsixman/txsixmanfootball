"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Device } from "@/lib/account/center";
import { unsubscribeThisBrowser } from "@/lib/push";
import { removeLinkedDevice } from "./center-actions";
import { longDate } from "./dates";
import { refreshThisBrowser, turnOnHere, useThisBrowser } from "./this-browser";

const BAD = "That did not work. Check your connection and try again.";

/**
 * This browser's push alerts (ADR 0058): on, off or not supported, with Turn off (the account's linked row for this browser is removed,
 * then the browser's own subscription is stopped) and Turn on (asks the browser's permission, subscribes, links it to the account).
 */
export function BrowserAlerts() {
  const browser = useThisBrowser();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function turnOff() {
    if (!browser.deviceId) return;
    setBusy(true);
    setNote("");
    const removed = await removeLinkedDevice(browser.deviceId).catch(() => ({ ok: false }));
    if (!removed.ok) {
      setNote(BAD);
      setBusy(false);
      return;
    }
    await unsubscribeThisBrowser();
    await refreshThisBrowser(); // the status line above now says off
    setBusy(false);
  }

  async function turnOn() {
    setBusy(true);
    setNote("");
    const result = await turnOnHere();
    // On success the status line above now says on.
    if (result !== "ok") setNote(result === "blocked" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : BAD);
    setBusy(false);
  }

  return (
    <div className="mt-2 max-w-sm">
      <div role="status" className="text-[15px] text-ink">
        {browser.status === "loading" && <p>Checking this browser&hellip;</p>}
        {browser.status === "unsupported" && <p>This browser cannot show push alerts. On an iPhone, add this site to your Home Screen first, then open it from there.</p>}
        {browser.status === "error" && <p>Could not check this browser right now. Try again in a minute.</p>}
        {browser.status === "on" && <p className="font-semibold">Push alerts are on in this browser.</p>}
        {browser.status === "off" && <p className="font-semibold">Push alerts are off in this browser.</p>}
        {note && <p className="mt-1 text-[14px] font-semibold">{note}</p>}
      </div>
      {browser.status === "on" && (
        <Button type="button" variant="outline" className="mt-2" onClick={turnOff} disabled={busy}>Turn off push alerts here</Button>
      )}
      {browser.status === "off" && (
        <Button type="button" variant="outline" className="mt-2" onClick={turnOn} disabled={busy}>Turn on push alerts here</Button>
      )}
    </div>
  );
}

/** The browsers linked to the account: a label, when it was linked and last used, "This browser" for the one open now, and Remove. */
export function DevicesList({ devices }: { devices: Device[] | null }) {
  const browser = useThisBrowser();
  const [gone, setGone] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (devices === null) return <p className="mt-2 max-w-sm text-[14px] text-muted">Your linked browsers are not available right now. Try again in a minute.</p>;
  const shown = devices.filter((d) => !gone.includes(d.id));

  async function remove(device: Device) {
    setBusy(device.id);
    setNote("");
    const removed = await removeLinkedDevice(device.id).catch(() => ({ ok: false }));
    if (!removed.ok) setNote(BAD);
    else {
      setGone((was) => [...was, device.id]);
      setNote(`Removed ${device.label}. Alerts to it have stopped.`);
      if (device.id === browser.deviceId) void refreshThisBrowser();
    }
    setBusy(null);
  }

  return (
    <div className="mt-2 max-w-prose">
      {shown.length ? (
        <ul>
          {shown.map((d) => (
            <li key={d.id} className="flex items-center gap-3 border-b border-line py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink">
                  {d.label}
                  {d.id === browser.deviceId && <span className="ml-2 border border-line bg-panel px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wider text-navy">This browser</span>}
                </p>
                <p className="text-[13px] text-muted">
                  Linked {longDate(d.linkedAt)} &middot; Last used {longDate(d.lastUsedAt)}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => remove(d)} disabled={busy === d.id}>
                Remove<span className="sr-only"> {d.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">No browsers are linked to your account. A browser is linked when you follow a team from it and allow notifications.</p>
      )}
      <div role="status" className="min-h-5 text-[14px] font-semibold text-ink">{note}</div>
    </div>
  );
}
