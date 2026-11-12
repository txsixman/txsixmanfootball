"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { finishSignUp, type WelcomeState } from "./actions";

export function WelcomeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(finishSignUp, {});
  // Controlled, so the fields stay put when the server asks the 13th-birthday question or reports a problem.
  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  return (
    <form action={action} className="mt-5 flex max-w-sm flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <Label htmlFor="displayName">Display name</Label>
      <Input id="displayName" name="displayName" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={24} autoComplete="nickname" aria-describedby="name-help" />
      <p id="name-help" className="text-[13px] text-muted">3 to 24 letters, numbers, spaces, dashes or underscores. Everyone can see it. Not your real name, please.</p>
      <Label htmlFor="birthYear">Birth year</Label>
      <Input id="birthYear" name="birthYear" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} required inputMode="numeric" pattern="[0-9]{4}" placeholder="2008" autoComplete="off" aria-describedby="year-help" />
      <p id="year-help" className="text-[13px] text-muted">The year only. You must be 13 or older. It is never shown to anyone.</p>
      {state.ask13 ? (
        <fieldset className="flex flex-col gap-2 border border-line p-3">
          <legend className="px-1 text-[15px] font-semibold text-ink">Have you had your 13th birthday?</legend>
          <div className="flex gap-2">
            <Button type="submit" name="turned13" value="yes" disabled={pending}>Yes</Button>
            <Button type="submit" name="turned13" value="no" variant="outline" disabled={pending}>No</Button>
          </div>
          <p className="text-[13px] text-muted">We use your answer once and do not keep it.</p>
        </fieldset>
      ) : (
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Finish sign-up"}</Button>
      )}
      <div role="status" aria-live="polite">{state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}</div>
    </form>
  );
}
