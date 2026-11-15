import Link from "next/link";
import type { CSSProperties } from "react";

/** Columns for a `wrap` row: as few lines as fit, then the tabs spread evenly over them (9 seasons on a phone: 5 and 4,
 * not 6 and 3 stretched across). `most` is how many tabs fit one line; long labels (five TAPPS brackets) fit fewer. */
const columns = (n: number, most: number) => Math.ceil(n / Math.ceil(n / most));

/** Page-level tabs as links (each tab is its own static page), the current one marked for screen readers. `wrap` lets a long
 * row (every season, five TAPPS brackets) break onto lines instead of running off a phone; its tabs sit on a grid of equal
 * columns, so the lines line up and the last line's tabs are no wider than the rest. */
export function TabNav({ label, tabs, current, wrap = false }: { label: string; tabs: { href: string; label: string }[]; current: string; wrap?: boolean }) {
  const long = tabs.some((t) => t.label.length > 6);
  const grid = wrap
    ? ({ "--cols": columns(tabs.length, long ? 3 : 5), "--cols-sm": columns(tabs.length, long ? 6 : 10) } as CSSProperties)
    : undefined;
  return (
    <nav
      aria-label={label}
      style={grid}
      className={`mt-4 border-b-2 border-navy ${wrap ? "grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] sm:grid-cols-[repeat(var(--cols-sm),minmax(0,1fr))]" : "flex"}`}
    >
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false} // tabs are other full tables (past seasons, other leagues): fetch one only when it is chosen
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center px-2 ${wrap ? "text-center" : "flex-auto whitespace-nowrap"} font-num text-[16px] font-bold uppercase tracking-wide ${
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
