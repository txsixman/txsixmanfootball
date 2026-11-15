import type { ReactNode } from "react";
import { EdgeToEdge } from "../ui";

// Scores run edge to edge, so rows use the whole phone width.
export default function ScoresLayout({ children }: { children: ReactNode }) {
  return (
    <EdgeToEdge>
      <div className="mx-auto max-w-3xl border-line bg-page sm:border-x">{children}</div>
    </EdgeToEdge>
  );
}
