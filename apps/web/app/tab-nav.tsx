import Link from "next/link";

/** Page-level tabs as links (each tab is its own static page), the current one marked for screen readers. `wrap` lets a long
 * row of long labels (five TAPPS brackets) break onto lines instead of running off a phone. */
export function TabNav({ label, tabs, current, wrap = false }: { label: string; tabs: { href: string; label: string }[]; current: string; wrap?: boolean }) {
  return (
    <nav aria-label={label} className={`mt-4 flex border-b-2 border-navy ${wrap ? "flex-wrap" : ""}`}>
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false} // tabs are other full tables (past seasons, other leagues): fetch one only when it is chosen
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 flex-auto items-center justify-center px-2 ${wrap ? "text-center" : "whitespace-nowrap"} font-num text-[16px] font-bold uppercase tracking-wide ${
              active ? "bg-band text-white" : "text-navy hover:bg-panel"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
