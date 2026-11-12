/** Points above or below the average rated team, always signed so 0 reads as "average". No imports, so pages in the
 * browser can use it (lib/ratings.ts re-exports it for server pages). */
export const signed = (n: number) => {
  const tenths = Math.round(Math.abs(n) * 10) / 10; // rounded first, so -0.04 reads "0.0", never "−0.0"
  return tenths === 0 ? "0.0" : `${n > 0 ? "+" : "−"}${tenths.toFixed(1)}`;
};
