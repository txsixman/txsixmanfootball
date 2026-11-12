import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/sign-in/actions";

/** The console's top bar, shown only by pages that passed `gate()`. */
export function AdminNav() {
  return (
    <nav aria-label="Admin" className="mb-6 flex flex-wrap items-center gap-x-1 border-b border-line pb-2">
      {[
        { href: "/admin", label: "Games" },
        { href: "/admin/merge", label: "Merge programs" },
        { href: "/admin/corrections", label: "Past corrections" },
        { href: "/admin/moderation", label: "Moderation" },
      ].map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-navy hover:underline">
          {l.label}
        </Link>
      ))}
      <form action={signOut} className="ml-auto">
        <Button type="submit" variant="ghost">Sign out</Button>
      </form>
    </nav>
  );
}
