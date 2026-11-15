"use client";

import { Button } from "@/components/ui/button";
import { clearSignedInHint } from "@/lib/account/follows";
import { thisBrowserEndpoint } from "@/lib/push";
import { signOut } from "../sign-in/actions";

/**
 * Sign out: forgets the "signed in here" hint the header and My teams use, tells the server which push subscription is this
 * browser's own (so the account's alerts stop here, ADR 0054; the server matches it to the signed-in account), then ends this
 * browser's session (server action). The endpoint is a secret: it goes only in this one request to this site.
 */
export function SignOutButton({ className }: { className?: string }) {
  async function signOutHere(data: FormData) {
    clearSignedInHint();
    const endpoint = await thisBrowserEndpoint();
    if (endpoint) data.set("pushEndpoint", endpoint);
    await signOut(data);
  }
  return (
    <form action={signOutHere} className={className}>
      <Button type="submit" variant="outline">Sign out</Button>
    </form>
  );
}
