import type { AnchorHTMLAttributes } from "react";

/** next/link for Ladle: a plain anchor (stories have no router). Next's own props are dropped. */
export default function Link({
  href,
  prefetch: _prefetch,
  scroll: _scroll,
  replace: _replace,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null; scroll?: boolean; replace?: boolean }) {
  return <a href={href} {...props} />;
}
