// What a State Championship game's share card says (the page's og:image, route.tsx). Pure, no imports: the node tests run it
// as it is (scripts/state-card.test.mjs).
//
// The title names the season and the bracket ("2026 TCAF State Championship"). Once the game is recorded and confirmed the
// card names its champion; a disputed or unplayed game names none (ADR 0040). A forfeit names its winner and shows no score.

/** The card's title: "2026 TAPPS Division I State Championship". */
export const stateCardTitle = (season: number, bracket: string) => `${season} ${bracket} State Championship`;

/** The champion line, or undefined while the game has no champion. */
export const championBanner = (final: { champion: string } | undefined) => (final ? `${final.champion} · State Champion` : undefined);
