"use client";

import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/account/follows";

/**
 * The landing page's word on fan accounts, only while they are on (FAN_SIGNIN, read per request by /api/me): the page is
 * built without it, so it never promises accounts the site does not offer. Shares the page's one /api/me request
 * (lib/account/follows.ts) and says nothing when it cannot be asked.
 */
export function FanAccountsLine() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchMe().then((a) => live && setOn(a?.enabled === true));
    return () => {
      live = false;
    };
  }, []);
  return on ? <span className="mt-1 block">A free fan account adds game comments and keeps your teams on every device.</span> : null;
}
