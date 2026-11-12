import Link from "next/link";
import type { ReactNode } from "react";
import type { Identity } from "@/lib/identity";
import { Crest } from "./programs/crest";

// Shared pieces for the list pages (rankings, results, records, standings, championships, matchup, scores), so they
// read as one system: one page header, one section bar, one logo slot, one board row, one empty state.

/** Eyebrow, big title, one-line note. `md` is for long titles that would wrap at 56px on a phone. */
export function PageHeader({ eyebrow, title, note, id, size = "lg" }: { eyebrow: ReactNode; title: string; note?: ReactNode; id?: string; size?: "lg" | "md" }) {
  return (
    <>
      <p className="text-[12px] font-bold uppercase tracking-widest text-red">{eyebrow}</p>
      <h1 id={id} className={`mt-0.5 font-num font-bold uppercase leading-none tracking-wide text-navy ${size === "lg" ? "text-[56px]" : "text-[44px]"}`}>
        {title}
      </h1>
      {note && <p className="mt-2 max-w-prose text-[14px] leading-5 text-muted">{note}</p>}
    </>
  );
}

/** The navy bar over a table or list. `aside` sits at the right edge, outside the heading (it is not part of its name). */
export function SectionBar({ id, title, aside, className = "mt-8" }: { id: string; title: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 bg-navy px-3 py-1 text-white ${className}`}>
      <h2 id={id} className="min-w-0 scroll-mt-4 font-num text-[18px] font-bold uppercase tracking-wider">{title}</h2>
      {aside && <p className="shrink-0 font-num text-[14px] font-semibold uppercase tracking-wide text-white/80">{aside}</p>}
    </div>
  );
}

/** Same-width box for a school's logo or badge, so team names line up down a list whatever the logo's shape.
 * `size` is the crest's height; a larger crest gets a box wide enough for the widest logo it draws (aspect 1.6). */
export function CrestSlot({ school, identity, size = 24 }: { school: string; identity: Identity; size?: number }) {
  return (
    <span className={`mr-2 flex shrink-0 justify-center ${size === 24 ? "w-10" : ""}`} style={size === 24 ? undefined : { width: Math.ceil(size * 1.6) + 2 }}>
      <Crest school={school} identity={identity} size={size} decorative />
    </span>
  );
}

/** One row of a ranked board: place, what it is, the one number that matters (`unit`: what that number counts, read aloud only). */
export function BoardRow({ place, children, figure, unit }: { place: number; children: ReactNode; figure: ReactNode; unit?: string }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-1">
      <span className="w-6 shrink-0 text-right font-num text-[17px] font-semibold text-muted">{place}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink">{children}</span>
      <span className="shrink-0 text-right font-num text-[24px] font-bold text-navy">
        {figure}
        {/* A bare number says nothing to a screen reader; `unit` names what it counts. */}
        {unit && <span className="sr-only"> {unit}</span>}
      </span>
    </li>
  );
}

/** Takes back the root <main>'s padding (`px-4 py-6 sm:py-8` in app/layout.tsx), so a page's white sheet runs edge to
 * edge on a phone and starts right under the header. Change both together. */
export function EdgeToEdge({ children }: { children: ReactNode }) {
  return <div className="-mx-4 -my-6 sm:-my-8">{children}</div>;
}

/** Nothing to show yet: say so inside a panel, and offer the next step. */
export function EmptyState({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="mt-6 border border-line bg-panel px-4 py-6 text-center text-[15px] text-ink">
      <p className="mx-auto max-w-prose">{children}</p>
      {action && (
        <Link href={action.href} className="mt-4 inline-flex min-h-11 items-center border-2 border-navy bg-white px-4 font-bold text-navy hover:bg-panel">
          {action.label}
        </Link>
      )}
    </div>
  );
}
