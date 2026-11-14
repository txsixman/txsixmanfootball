import { SITE_URL } from "@/lib/site";
import { indexXml, newest } from "@/lib/sitemap-xml";
import { KINDS, sitemapEntries } from "../sitemaps/lists";

// /sitemap.xml, the address robots.txt and Search Console name: an index of one sitemap per kind of page. Each one's
// lastmod is the newest of its pages' (from the data, never the build time).
export const dynamic = "force-static";

export async function GET() {
  const entries = await Promise.all(
    KINDS.map(async (kind) => ({ url: `${SITE_URL}/sitemaps/${kind}.xml`, lastmod: newest((await sitemapEntries(kind)).map((e) => e.lastmod)) })),
  );
  return new Response(indexXml(entries), { headers: { "content-type": "application/xml; charset=utf-8" } });
}
