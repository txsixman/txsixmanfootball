// A site's street address (ADR 0066), as data/seed/game-details and data/seed/schools/home-fields.csv keep it: the street
// line (a comma written " - "), city, two-letter state and ZIP. A page shows it under the site with a Directions link: a
// maps search for the address, with no key and no embedded map. Never coordinates; no page names where it came from.

export type Address = { street: string; city: string; state: string; zip: string };

/** The address from a facts row's columns, or undefined with no street. */
export function addressFrom(r: { site_street?: string; site_city?: string; site_state?: string; site_zip?: string }): Address | undefined {
  const street = r.site_street?.trim() ?? "";
  return street ? { street, city: r.site_city?.trim() ?? "", state: r.site_state?.trim() ?? "", zip: r.site_zip?.trim() ?? "" } : undefined;
}

/** "1200 FM 1188, Gate #2, Jayton, TX 79528": the file's " - " read back as a comma, blank parts left out. */
export function addressLine(a: Address): string {
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street.replace(/ - /g, ", "), a.city, stateZip].filter(Boolean).join(", ");
}

/** A maps search for the site at its address, opened in the visitor's own maps app or browser. */
export function directionsUrl(site: string, a: Address): string {
  const name = site.replace(/ \(home\)$/, "").split(", ")[0];
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${addressLine(a)}`)}`;
}
