// Where each game of a bracket sits in the tree view (ADR 0048): rounds as columns, the two halves meeting at the final in
// the middle, each game halfway between the two games that feed it. Pure, no imports: the page, the exported image and the
// node tests all run it as it is. Units are columns and rows; the renderer turns them into pixels.

/** A game of the tree: its id, and the ids of the two games that feed its sides (null for a team placed there or a bye). */
export type TreeNode = { id: string; feeds: [string | null, string | null]; group?: string };

/** A game's place: its column (0 at the left edge), its row (0 at the top; a half row between two feeders is allowed),
 * and which half it is in. The final is "center". */
export type Placed = { id: string; col: number; row: number; half: "left" | "right" | "center" };

/** A labeled block of first-column games ("Region 1"), from its top row to its bottom row. */
export type Group = { label: string; half: "left" | "right"; col: number; top: number; bottom: number };

export type TreeLayout = { cols: number; rows: number; placed: Placed[]; links: { from: string; to: string }[]; groups: Group[] };

/**
 * Lays out the tree under its final: the game no other game feeds, the one with the most games under it when there are
 * several (a game that feeds nothing else and is not under the final is left out of the tree; the list view still shows
 * it). Its first feeder's games go on the left, its second's on the right, mirrored, so both halves meet in the middle.
 * A one-sided tree (a final fed by one game) runs left to right.
 */
export function layoutTree(nodes: TreeNode[]): TreeLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fed = new Set(nodes.flatMap((n) => n.feeds.filter((f): f is string => f !== null && byId.has(f))));
  const kids = (n: TreeNode) => n.feeds.filter((f): f is string => f !== null && byId.has(f)).map((f) => byId.get(f)!);
  const size = (n: TreeNode, seen = new Set<string>()): number => {
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    return 1 + kids(n).reduce((sum, k) => sum + size(k, seen), 0);
  };
  const roots = nodes.filter((n) => !fed.has(n.id)).sort((a, b) => size(b) - size(a));
  const root = roots[0];
  if (!root) return { cols: 0, rows: 0, placed: [], links: [], groups: [] };

  const depthOf = (n: TreeNode, seen = new Set<string>()): number =>
    seen.has(n.id) ? 0 : (seen.add(n.id), 1 + Math.max(0, ...kids(n).map((k) => depthOf(k, seen))));
  const sides = kids(root);
  const two = sides.length === 2;
  const deepest = Math.max(0, ...sides.map((s) => depthOf(s)));
  const center = deepest; // the final's column
  const placed: Placed[] = [];
  const links: { from: string; to: string }[] = [];
  const leaves = new Map<string, number>(); // first-column leaves of each half, for the group labels

  /** Places a half's subtree: leaves on consecutive rows in feed order, each game at the middle of its feeders' rows. */
  const half = (top: TreeNode, side: "left" | "right") => {
    let next = 0;
    const seen = new Set<string>();
    const place = (n: TreeNode, depth: number): number => {
      if (seen.has(n.id)) return placed.find((p) => p.id === n.id)!.row;
      seen.add(n.id);
      const below = kids(n);
      const rows = below.map((k) => {
        links.push({ from: k.id, to: n.id });
        return place(k, depth + 1);
      });
      const row = rows.length ? (Math.min(...rows) + Math.max(...rows)) / 2 : next++;
      if (!rows.length) leaves.set(n.id, row);
      placed.push({ id: n.id, col: side === "left" ? center - depth : center + depth, row, half: side });
      return row;
    };
    place(top, 1);
    return next; // rows used
  };

  const used = sides.map((s, i) => {
    const start = placed.length;
    const rows = half(s, two && i === 1 ? "right" : "left");
    return { start, rows };
  });
  const rows = Math.max(1, ...used.map((u) => u.rows));
  // Center a shorter half against the taller one.
  used.forEach((u, i) => {
    const shift = (rows - u.rows) / 2;
    const end = i + 1 < used.length ? used[i + 1].start : placed.length;
    for (let j = u.start; j < end; j++) placed[j].row += shift;
    for (const [id, r] of leaves) if (placed.slice(u.start, end).some((p) => p.id === id)) leaves.set(id, r + shift);
  });
  const rootRows = sides.map((s) => placed.find((p) => p.id === s.id)!.row);
  for (const s of sides) links.push({ from: s.id, to: root.id });
  placed.push({ id: root.id, col: center, row: rootRows.length ? (Math.min(...rootRows) + Math.max(...rootRows)) / 2 : 0, half: "center" });

  // Group labels: a run of leaves with one group, in each half.
  const groups: Group[] = [];
  for (const p of placed) {
    const g = byId.get(p.id)!.group;
    if (!g || !leaves.has(p.id) || p.half === "center") continue;
    const found = groups.find((x) => x.label === g && x.half === p.half);
    if (found) {
      found.top = Math.min(found.top, p.row);
      found.bottom = Math.max(found.bottom, p.row);
    } else groups.push({ label: g, half: p.half, col: p.col, top: p.row, bottom: p.row });
  }
  const cols = two ? 2 * deepest + 1 : deepest + 1;
  for (const g of groups) g.col = g.half === "left" ? 0 : cols - 1; // labels sit over the outer column
  groups.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
  return { cols, rows, placed, links, groups };
}
