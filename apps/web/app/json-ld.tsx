import { jsonLdText } from "@/lib/json-ld";

/** Structured data for search engines, built in lib/json-ld.ts, which also makes the text safe inside a script tag. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
