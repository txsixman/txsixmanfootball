import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./ui";

// Any address with no page: answers 404 (Next adds noindex), offers a search and the main sections. A plain form, so it
// needs no script: it sends ?q= to /search, which runs the search on arrival.
export const metadata: Metadata = { title: "Page not found" };

const PLACES = [
  { href: "/scores", label: "Scores" },
  { href: "/playoffs", label: "Playoffs" },
  { href: "/rankings", label: "Rankings" },
  { href: "/programs", label: "Programs" },
  { href: "/results", label: "Results" },
];

export default function NotFound() {
  return (
    <section aria-labelledby="not-found">
      <PageHeader eyebrow="Page not found" title="Not here" id="not-found" note="This address has no page. A school or a week may have moved: search for it, or start from a section." />
      <form action="/search" method="get" role="search" className="mt-6 flex max-w-md gap-2">
        <label htmlFor="not-found-q" className="sr-only">
          Search programs and weeks
        </label>
        <Input id="not-found-q" name="q" type="search" placeholder="A school or a week" className="h-11 min-w-0 flex-1" />
        <Button type="submit" className="h-11">
          Search
        </Button>
      </form>
      <h2 className="mt-8 font-num text-[18px] font-bold uppercase tracking-wider text-navy">Sections</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {PLACES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} prefetch={false} className="flex min-h-11 items-center border border-line px-4 text-[15px] font-semibold text-navy hover:bg-navy hover:text-white">
              {p.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/" prefetch={false} className="flex min-h-11 items-center border border-line px-4 text-[15px] font-semibold text-navy hover:bg-navy hover:text-white">
            Home
          </Link>
        </li>
      </ul>
    </section>
  );
}
