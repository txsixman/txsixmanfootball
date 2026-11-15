import { addressLine, directionsUrl, type Address } from "@/lib/address";

/** A site's street address and a maps search for it (ADR 0066): no key, no embedded map, no source named. The game page,
 * the scores page's next games and a bracket's next games show the same block, so a fan finds the way from any of them. */
export function SiteAddress({ site, address }: { site: string; address: Address }) {
  return (
    <span className="block" data-address>
      <span className="block">{addressLine(address)}</span>
      <a
        href={directionsUrl(site, address)}
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-4 hover:text-red"
        data-directions
      >
        Directions<span className="sr-only"> to {site.replace(/ \(home\)$/, "")}, a map search</span>
      </a>
    </span>
  );
}
