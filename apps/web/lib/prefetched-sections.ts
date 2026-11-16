/** Sections worth loading ahead on every page: the two a fan opens again and again on a game night (ADR 0080). A
 * section link prefetches its whole page the moment it shows (10 to 30 KB each), so the other seven cost a phone on a
 * weak signal about 85 KB per page it opens, for pages most visits never open; they load when tapped. */
export const PREFETCHED_SECTIONS = ["/scores", "/playoffs"];
