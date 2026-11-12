import Link from "next/link";

/** Previous and next links for a paged list: `?page=n` on `base`. Nothing when everything fits on one page. */
export function Pager({ base, page, total, per }: { base: string; page: number; total: number; per: number }) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages <= 1) return null;
  const href = (n: number) => (n === 1 ? base : `${base}?page=${n}`);
  const link = "inline-flex min-h-11 items-center px-3 text-[15px] font-semibold text-navy underline underline-offset-2";
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-1">
      {page > 1 ? <Link href={href(page - 1)} className={link} rel="prev">Newer</Link> : <span />}
      <p className="text-[14px] text-muted">Page {page} of {pages}</p>
      {page < pages ? <Link href={href(page + 1)} className={link} rel="next">Older</Link> : <span />}
    </nav>
  );
}
