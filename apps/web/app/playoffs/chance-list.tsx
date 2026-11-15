import Link from "next/link";
import { EMPTY, type loadIdentities } from "@/lib/identity";
import { slugify } from "@/lib/slug";
import { CrestSlot } from "../ui";

/** One list of title chances (a bracket's state title, or a UIL region's title), each team linked to its program. */
export function ChanceList({ id, title, chances, identities }: {
  id: string; title: string; chances: { team: string; chance: number }[]; identities: Awaited<ReturnType<typeof loadIdentities>>;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="sub-title">{title}</h3>
      <ul>
        {chances.map((c) => {
          const slug = slugify(c.team);
          const pct = Math.round(c.chance * 100);
          return (
            <li key={c.team} className="flex items-center gap-2 border-b border-line">
              <Link href={`/programs/${slug}`} className="flex min-h-11 min-w-0 flex-1 items-center text-ink hover:text-navy hover:underline">
                <CrestSlot school={c.team} identity={identities.get(slug) ?? EMPTY} />
                <span className="line-clamp-2 min-w-0 leading-tight">{c.team}</span>
              </Link>
              <span aria-hidden="true" className="h-2 w-12 shrink-0 bg-panel sm:w-16">
                <span className="block h-2 bg-alert" style={{ width: `${Math.max(2, pct)}%` }} />
              </span>
              <span className="w-12 text-right font-num text-[18px] font-bold tabular-nums text-navy">
                {c.chance < 0.01 ? "<1%" : c.chance > 0.99 ? ">99%" : `${pct}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
