import type { ReactNode } from "react";
import { gameIds } from "@/lib/game-pages";

// The game ids live here, not on page.tsx: Next hands a segment's params down from its layout, and the share card
// (opengraph-image.tsx, which uses generateImageMetadata) gets its ids only from a parent. With the ids on the page, the
// card route built no images and every game's og:image was a 404 (Nov 13, 2026).
export const dynamicParams = false;

export const generateStaticParams = async () => (await gameIds()).map((id) => ({ id }));

export default function GameLayout({ children }: { children: ReactNode }) {
  return children;
}
