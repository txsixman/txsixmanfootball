import type { Identity } from "@/lib/identity";

const initials = (name: string) =>
  name.replace(/-.*$/, "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("") || name[0];

/**
 * The school's logo from its own site, or a badge in its colors when there is none (ADR 0006).
 * The box widens for a wide logo up to maxAspect; a wordmark wider than that would be unreadable, so it gets the badge.
 */
export function Crest({
  school,
  identity,
  size,
  maxAspect = 1.6,
  decorative = false,
}: {
  school: string;
  identity: Identity;
  size: number;
  maxAspect?: number;
  /** Beside the school's name in a link, the logo adds nothing for a screen reader. */
  decorative?: boolean;
}) {
  const logo = identity.logo && identity.logo.aspect <= maxAspect ? identity.logo : null;
  if (logo) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{
          width: size * Math.max(1, logo.aspect),
          height: size,
          padding: Math.round(size * 0.08), // pixels: a percentage would follow the parent's width
          background: logo.light ? identity.theme.bg : "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small fixed-size logos, served as-is per ADR 0006 */}
        <img src={size <= 48 ? logo.small : logo.src} alt={decorative ? "" : `${school} logo`} loading={decorative ? "lazy" : "eager"} className="size-full object-contain" />
      </span>
    );
  }
  const { bg, fg, stripe } = identity.theme;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center font-num font-bold leading-none"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.42, boxShadow: stripe ? `inset 0 -${Math.max(2, size / 12)}px 0 ${stripe}` : undefined }}
    >
      {initials(school)}
    </span>
  );
}
