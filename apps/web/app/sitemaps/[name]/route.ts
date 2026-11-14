import { urlsetXml } from "@/lib/sitemap-xml";
import { KINDS, sitemapEntries } from "../lists";

// /sitemaps/<kind>.xml: one kind of page (app/sitemaps/lists.ts), listed in the index at /sitemap.xml.
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => KINDS.map((kind) => ({ name: `${kind}.xml` }));

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const kind = KINDS.find((k) => `${k}.xml` === name);
  if (!kind) return new Response("Not found", { status: 404 });
  return new Response(urlsetXml(await sitemapEntries(kind)), { headers: { "content-type": "application/xml; charset=utf-8" } });
}
