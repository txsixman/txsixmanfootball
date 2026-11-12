"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchMe, type MeAnswer } from "@/lib/account/follows";

// Pages a fan without a profile may still read: sign-up itself, the sign-in pages, the terms they are agreeing to, and the admin console (its own gate).
const OPEN_TO_UNFINISHED = /^\/(account|auth|sign-in|privacy|terms|admin)(\/|$)/;

/**
 * The header's account link: "Sign in", or the display name, once the page has asked /api/me. Static pages are built
 * without it; this fills in after load, so no page becomes dynamic. A signed-in fan who has not
 * finished sign-up is sent to /account/welcome from any page that is not part of sign-up.
 */
export function AccountLink() {
  const [answer, setAnswer] = useState<MeAnswer | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const enabled = answer?.enabled === true;
  const me = answer?.me ?? null;

  // Asked again on every navigation, so the link follows a sign-in, a sign-out or a deleted account without a reload. The
  // first ask shares the page's one request with the Follow button and My teams.
  const first = useRef(true);
  useEffect(() => {
    let live = true;
    void fetchMe(!first.current).then((a) => live && setAnswer(a ?? null));
    first.current = false;
    return () => {
      live = false;
    };
  }, [pathname]);

  const unfinished = enabled && me !== null && me.displayName === null && !me.admin;
  useEffect(() => {
    if (unfinished && !OPEN_TO_UNFINISHED.test(pathname)) router.replace(`/account/welcome?next=${encodeURIComponent(pathname)}`);
  }, [unfinished, pathname, router]);

  // Nothing until the answer comes, and nothing at all while fan accounts are off (a signed-in admin still sees the link to
  // /admin on an admin page, where /api/me answers). The pages are built without it, so flipping FAN_SIGNIN needs no rebuild.
  if (!answer || (!enabled && me === null)) return null;
  const adminLink = me !== null && (!enabled || (me.displayName === null && me.admin));
  const here = pathname === "/account" || pathname === "/sign-in";
  const label = adminLink ? "Admin" : me === null ? "Sign in" : (me.displayName ?? "Finish sign-up");
  return (
    <Link
      href={adminLink ? "/admin" : me === null ? "/sign-in" : unfinished ? "/account/welcome" : "/account"}
      aria-current={here ? "page" : undefined}
      className={`inline-flex min-h-11 max-w-36 items-center truncate px-2 hover:text-white ${here ? "text-white underline decoration-red decoration-4 underline-offset-[10px]" : "text-white/85"}`}
    >
      {me !== null && !unfinished && !adminLink && <span className="sr-only">Your account: </span>}
      <span className="truncate">{label}</span>
    </Link>
  );
}
