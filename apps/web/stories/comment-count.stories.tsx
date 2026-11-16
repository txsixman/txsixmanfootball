import { CommentCount, CommentCountLink } from "@/app/scores/comment-count";

// The comment count of a game (ADR 0077), as plain text inside a card that is itself a link, and as a link for a row that is
// not. The route is answered here, by invented games' keys; a game with no comments draws nothing at all, as on the site.
export default { title: "Comment count" };

const COUNTS: Record<string, number> = { "2026-bi-district-gamma-at-delta": 1, "2026-bi-district-epsilon-at-zeta": 12 };
if (typeof window !== "undefined") {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) =>
    String(input).startsWith("/api/games/comment-counts") ? Promise.resolve(Response.json({ counts: COUNTS })) : real(input, init);
}

export const PlainText = () => (
  <div className="max-w-sm border border-line">
    {[...Object.keys(COUNTS), "2026-bi-district-eta-at-theta"].map((key) => (
      <div key={key} className="border-b border-line px-3 py-2 text-[15px]">
        {key}
        <CommentCount gameKey={key} className="mt-0.5 flex" />
      </div>
    ))}
  </div>
);

export const AsLink = () => (
  <div className="max-w-sm border border-line px-3">
    {Object.keys(COUNTS).map((key) => (
      <div key={key}>
        <CommentCountLink gameKey={key} className="flex" />
      </div>
    ))}
  </div>
);
