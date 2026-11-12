import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { adminState } from "@/lib/auth/admin";
import { githubToken } from "@/lib/admin/service";
import { signOut } from "@/app/sign-in/actions";

/**
 * Every admin page starts with this: the page itself when the visitor is the admin, else a plain page that shows no data.
 * (A layout cannot do it: a layout does not render again when you move between pages, so each page checks for itself,
 * and each server action checks again, lib/admin/service.ts.)
 */
export async function gate(): Promise<{ ok: true } | { ok: false; page: ReactNode }> {
  const state = await adminState();
  if (state.kind === "admin" && githubToken()) return { ok: true };
  if (state.kind === "unconfigured" || (state.kind === "admin" && !githubToken())) {
    return { ok: false, page: <Plain title="Admin is not configured" note="Nothing is shown here until the environment is set up." /> };
  }
  if (state.kind === "denied") {
    return {
      ok: false,
      page: (
        <Plain title="Not allowed" note="This account cannot use the admin console.">
          <form action={signOut} className="mt-4">
            <Button type="submit" variant="outline">Sign out</Button>
          </form>
        </Plain>
      ),
    };
  }
  return {
    ok: false,
    page: (
      <Plain title="Admin" note="Sign in to continue.">
        <Button asChild className="mt-4">
          <Link href="/sign-in?next=/admin">Sign in</Link>
        </Button>
      </Plain>
    ),
  };
}

function Plain({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return (
    <section aria-labelledby="admin-title" className="max-w-prose">
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">{title}</h1>
      <p className="mt-2 text-[15px] text-muted">{note}</p>
      {children}
    </section>
  );
}
