import { createHash } from "node:crypto";

// A share card's address carries a version, so a link preview that cached an old card (Facebook keeps one for weeks) fetches the
// new one: the address changes exactly when what the card says changes, and not on a deploy that leaves it alone. The version
// is a short hash of the content the card is drawn from, taken at build time by the page's metadata, beside the card's own route.
export const cardVersion = (content: unknown): string => createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 8);

/** A card's address with its version: `/programs/<slug>/card?v=1a2b3c4d`. */
export const versioned = (url: string, content: unknown): string => `${url}?v=${cardVersion(content)}`;
