"use client";

import { Button } from "@/components/ui/button";
import { clearSignedInHint } from "@/lib/account/follows";
import { signOut } from "../sign-in/actions";

/** Sign out: ends this browser's session (server action) and forgets the "signed in here" hint the header and My teams use. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut} onSubmit={clearSignedInHint} className={className}>
      <Button type="submit" variant="outline">Sign out</Button>
    </form>
  );
}
