"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearSignedInHint } from "@/lib/account/follows";
import { signOutEverywhere, type SignOutAllState } from "./center-actions";

/** Sign out of all devices (ADR 0058), in two steps: the first button asks, only the second signs out. Every linked browser is removed, then every session of the account ends. */
export function SignOutEverywhere() {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<SignOutAllState, FormData>(signOutEverywhere, {});
  return (
    <div className="mt-3">
      {asking ? (
        <form action={action} onSubmit={clearSignedInHint} className="flex max-w-sm flex-col gap-3 border border-line p-3">
          <p className="text-[15px] font-semibold text-ink">Sign out of every device?</p>
          <p className="text-[14px] text-muted">Every browser you are signed in on is signed out, and every browser linked for push alerts is removed. You can sign in again any time.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Signing out…" : "Yes, sign out everywhere"}</Button>
            <Button type="button" variant="outline" onClick={() => setAsking(false)} disabled={pending}>Cancel</Button>
          </div>
          <div role="status">{state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}</div>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAsking(true)}>Sign out of all devices</Button>
      )}
    </div>
  );
}
