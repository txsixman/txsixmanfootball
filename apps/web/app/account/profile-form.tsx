"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameDisplayName, type RenameState } from "./center-actions";
import { longDate } from "./dates";

/**
 * Change the display name (ADR 0058): sign-up's rules, and one change every 30 days, which the database holds. While the clock is
 * running (`nextChangeAt` is set) the form is off and says when it opens; a change that the database refuses for the clock shows the
 * same sentence. The error text comes from the server.
 */
export function ProfileForm({ displayName, nextChangeAt }: { displayName: string; nextChangeAt: string | null }) {
  const [state, action, pending] = useActionState<RenameState, FormData>(renameDisplayName, {});
  const [name, setName] = useState(displayName);
  const until = nextChangeAt ?? state.nextAt ?? null;
  const locked = until !== null;
  return (
    <form action={action} className="mt-3 flex max-w-sm flex-col gap-2">
      <Label htmlFor="displayName">Change display name</Label>
      <Input
        id="displayName"
        name="displayName"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={3}
        maxLength={24}
        autoComplete="nickname"
        disabled={locked || pending}
        aria-describedby="name-help"
      />
      <p id="name-help" className="text-[13px] text-muted">3 to 24 letters, numbers, spaces, dashes or underscores. Everyone can see it. You can change it once every 30 days.</p>
      <div>
        <Button type="submit" disabled={locked || pending || name.trim() === displayName}>{pending ? "Saving…" : "Save display name"}</Button>
      </div>
      <div role="status">
        {state.saved && <p className="text-[14px] font-semibold text-ink">Saved.</p>}
        {locked && <p className="text-[14px] font-semibold text-ink">You can change it again on {longDate(until)}.</p>}
        {state.error && !state.nextAt && <p className="text-[14px] font-semibold text-red">{state.error}</p>}
      </div>
    </form>
  );
}
