import type { ReactNode } from "react";

/** Shared frame for the privacy and terms pages: a title, the date, then plain sections. */
export function LegalPage({ id, title, updated, children }: { id: string; title: string; updated: string; children: ReactNode }) {
  return (
    <article aria-labelledby={id} className="max-w-prose text-[15px] leading-6 text-ink">
      <h1 id={id} className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">{title}</h1>
      <p className="mt-2 text-[13px] text-muted">Last updated {updated}</p>
      {children}
    </article>
  );
}

export const LegalH2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-8 font-num text-[22px] font-bold uppercase tracking-wide text-navy">{children}</h2>
);
