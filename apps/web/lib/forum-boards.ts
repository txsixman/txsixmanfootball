// The forum's fixed boards (ADR 0018). Twin of the rows migration 0015 inserts into forum_board: change both together
// (packages/db/test/forums.test.mjs compares them). No imports, so the node tests read it as it is.

export const BOARDS = [
  { slug: "general", name: "General", description: "Anything about Texas six-man football." },
  { slug: "uil-division-1", name: "UIL Division I", description: "UIL six-man Division I teams, districts and rankings." },
  { slug: "uil-division-2", name: "UIL Division II", description: "UIL six-man Division II teams, districts and rankings." },
  { slug: "private-schools", name: "Private schools", description: "TAPPS, TAIAO, TCAF and independent six-man programs." },
  { slug: "playoffs", name: "Playoffs", description: "Brackets, matchups and the road to the state finals." },
] as const;

export const boardOf = (slug: string) => BOARDS.find((b) => b.slug === slug);
