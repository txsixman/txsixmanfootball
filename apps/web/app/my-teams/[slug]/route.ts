import { loadAlignments, uniquePrograms } from "@/lib/alignments";
import { loadMyTeams } from "@/lib/my-teams";

// One small JSON file per program for the home page's "My teams" block (app/my-teams/block.tsx), which asks only for
// the programs this browser follows. Static, like every page: rebuilt with each deploy.
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const team = (await loadMyTeams()).get((await params).slug);
  return team ? Response.json(team) : new Response("Not found", { status: 404 });
}
