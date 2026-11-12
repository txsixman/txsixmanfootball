import { splitLinks } from "../moderation/check";

// A post's text as React nodes: plain text (React escapes it; no HTML or markdown is ever interpreted) with each
// http(s) address made a text link. Never embedded, previewed or unfurled; rel keeps search engines and the opened page
// away from us (ADR 0018). Anything else that looks like an address (no scheme) stays text. The addresses are found by
// the same pattern the post rules count them with (splitLinks), so no clickable address goes uncounted.
export function PostText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-5 text-ink">
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} rel="nofollow ugc noopener" referrerPolicy="no-referrer" target="_blank" className="break-all font-semibold text-navy underline">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}
