import type { Identity } from "@/lib/identity";

/** The badge's letters when a school has no logo it can use. */
export const initials = (name: string) =>
  name.replace(/-.*$/, "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("") || name[0];

/** The logo a crest draws, or null when there is none or it is wider than `maxAspect` (a wordmark that wide would be unreadable). */
export const crestLogo = (identity: Identity, maxAspect: number) => (identity.logo && identity.logo.aspect <= maxAspect ? identity.logo : null);

/** The copy sized for a crest of this height (ADR 0022). */
export const logoCopy = (logo: NonNullable<Identity["logo"]>, size: number) => (size <= 24 ? logo.tiny : size <= 48 ? logo.small : logo.large);

/** The widest logo a program page's header crest draws; a wider one gets the badge. */
export const HEADER_CREST_MAX_ASPECT = 4.8;

/** The header crest's height: a wide wordmark is drawn smaller, so it never fills the band; the logo itself is untouched (ADR 0006). */
export const headerCrestSize = (identity: Identity) =>
  identity.logo && identity.logo.aspect > 2 ? Math.max(49, Math.min(72, Math.floor(260 / identity.logo.aspect))) : 72;

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
  const logo = crestLogo(identity, maxAspect);
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
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size logos, a copy sized for the crest (ADR 0022) */}
        <img src={logoCopy(logo, size)} alt={decorative ? "" : `${school} logo`} loading={decorative ? "lazy" : "eager"} className="size-full object-contain" />
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
