"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendSignInLink, type SignInState } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(sendSignInLink, {});
  return (
    <form action={action} className="mt-5 flex max-w-sm flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <Label htmlFor="email">Email</Label>
      <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
      <div role="status" aria-live="polite">
        {state.sent && <p className="text-[14px] text-ink">If that address can sign in, a link is on its way. It works once, for a few minutes.</p>}
        {state.error && <p className="text-[14px] font-semibold text-red">{state.error}</p>}
      </div>
    </form>
  );
}
