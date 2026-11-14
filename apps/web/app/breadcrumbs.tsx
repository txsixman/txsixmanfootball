import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { breadcrumbList, type Crumb } from "@/lib/json-ld";
import { JsonLd } from "./json-ld";

/** Where this page sits: Home, its section, then the page itself (the last crumb, not a link). One list draws the trail and writes its markup.
 * One line on a phone: the links keep their width and the page's own name, which its heading repeats in full, is cut short
 * with an ellipsis rather than wrapping onto a line of its own. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const last = trail.length - 1;
  return (
    <>
      <nav aria-label="Breadcrumb" className="border-b border-line">
        <ol className="flex items-center px-3 text-[14px] font-semibold">
          {trail.map((c, i) => (
            <li key={c.href} className={`flex items-center ${i === last ? "min-w-0 flex-1" : "shrink-0"}`}>
              {i === last ? (
                <span aria-current="page" title={c.name} className="block min-h-11 truncate py-3 leading-5 text-ink">
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
