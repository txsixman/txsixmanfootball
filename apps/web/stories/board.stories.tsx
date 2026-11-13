import Board from "@/app/scores/board";
import { demoGames } from "@/lib/demo-games";
import type { Identity } from "@/lib/identity"; // the type only: lib/identity.ts reads files, which a story cannot

// The scores board in each state, from the invented demo schools only (lib/demo-games.ts).
export default { title: "Scores board" };

const pick = (title: string, keep: (g: (typeof demoGames)[number]) => boolean) => {
  const games = demoGames.filter(keep);
  if (games.length === 0) throw new Error(`no demo game for "${title}"`); // a story with nothing to show is broken
  return <Board games={games} eyebrow="Sample" title={title} />;
};

export const Live = () => pick("Live", (g) => g.state === "live");
export const Final = () => pick("Final", (g) => g.state === "final" && g.verification === "confirmed");
export const Unconfirmed = () => pick("Unconfirmed", (g) => g.verification === "unconfirmed");
export const Postponed = () => pick("Postponed", (g) => g.state === "postponed");
export const Everything = () => <Board games={demoGames} eyebrow="Sample" title="Every state" />;

// A line with a crest: a drawn mark for one invented school (a logo), a badge in its color for the rest.
const mark = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="14" fill="none" stroke="#7a1f2b" stroke-width="8"/><text x="50" y="66" font-family="sans-serif" font-size="48" font-weight="700" text-anchor="middle" fill="#7a1f2b">CG</text></svg>',
)}`;
const crests: Record<string, Identity> = Object.fromEntries(
  demoGames.flatMap((g) => [g.home, g.away]).map((team): [string, Identity] => [
    team.name,
    {
      mascot: team.mascot,
      colors: [],
      logo: team.name === "Cedar Gap" ? { src: mark, small: mark, tiny: mark, large: mark, aspect: 1, light: false } : null,
      theme: { bg: team.color, fg: "#ffffff", stripe: null },
    },
  ]),
);
export const WithCrests = () => <Board games={demoGames} eyebrow="Sample" title="With crests" crests={crests} />;
