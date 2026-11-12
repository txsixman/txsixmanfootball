import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { breadcrumbList, type Crumb } from "@/lib/json-ld";
import { JsonLd } from "./json-ld";

/** Where this page sits: Home, its section, then the page itself (the last crumb, not a link). One list draws the trail and writes its markup. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const last = trail.length - 1;
  return (
    <>
      <nav aria-label="Breadcrumb" className="border-b border-line">
        <ol className="flex flex-wrap items-center px-3 text-[14px] font-semibold">
          {trail.map((c, i) => (
            <li key={c.href} className="flex min-w-0 items-center">
              {i === last ? (
                <span aria-current="page" className="inline-flex min-h-11 items-center py-1 leading-5 text-ink">
                  {c.name}
                </span>
              ) : (
                <>
                  <Link href={c.href} className="inline-flex min-h-11 min-w-11 items-center justify-center text-navy hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy">
                    {c.name}
                  </Link>
                  <ChevronRight aria-hidden="true" className="mx-0.5 size-4 shrink-0 text-muted" strokeWidth={2.5} />
                </>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd data={breadcrumbList(trail)} />
    </>
  );
}
