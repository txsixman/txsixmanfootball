import { bracketSlug, loadBrackets } from "@/lib/brackets";
import { treeImage } from "../../../../tree/image";
import { treeData } from "../../../../tree/data";

// "Download image" on a bracket page (ADR 0049): /playoffs/bracket/<slug>/image/share.png (1200 by 630) and full.png (the
// drawing at the page's size, only for a bracket drawn as one tree). Built with the site, like every page: a plain route
// with its own static params (an image under [slug] lists none otherwise).
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const brackets = await loadBrackets();
  const whole = await Promise.all(brackets.map(async (b) => (await treeData(b)).whole));
  return brackets.flatMap((b, i) => ["share.png", ...(whole[i] ? ["full.png"] : [])].map((size) => ({ slug: bracketSlug(b.name), size })));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; size: string }> }) {
  const { slug, size } = await params;
  const b = (await loadBrackets()).find((x) => bracketSlug(x.name) === slug)!;
  return treeImage(await treeData(b), size === "full.png" ? "full" : "share");
}
