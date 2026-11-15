"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearSignedInHint } from "@/lib/account/follows";
import { deleteAccount, type DeleteState } from "./actions";

/** Two steps: "Delete my account" opens the question, and only the second button deletes. */
export function DeleteAccount() {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, {});
  return (
    <div className="mt-2">
      {asking ? (
        <form action={action} onSubmit={clearSignedInHint} className="flex max-w-sm flex-col gap-3 border border-red p-3">
          <input type="hidden" name="confirm" value="yes" />
          <p className="text-[15px] font-semibold text-ink">Delete your account for good?</p>
          <p className="text-[14px] text-muted">Your display name, follows and sign-in are erased. This cannot be undone.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="bg-alert text-white hover:bg-alert/90">{pending ? "Deleting…" : "Yes, delete my account"}</Button>
            <Button type="button" variant="outline" onClick={() => setAsking(false)} disabled={pending}>Cancel</Button>
          </div>
          <div role="alert">{state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}</div>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAsking(true)}>Delete my account</Button>
      )}
    </div>
  );
}
