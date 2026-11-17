import { loadAlignments, uniquePrograms } from "@/lib/alignments";
import { programCalendarGames } from "@/lib/calendar-games";
import { calendarFile, calendarResponse } from "@/lib/calendar";
import { CURRENT_SEASON } from "@/lib/season";

// A school's games this season as a calendar a phone subscribes to (ADR 0095): the games still to play, and the ones played with
// the final in the description (a confirmed final only). Written at build time, so it is as fresh as the last deploy.
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const school = (await loadAlignments()).find((a) => a.slug === slug);
  if (!school) return new Response("Not found", { status: 404 });
  return calendarResponse(calendarFile(`${school.school} ${CURRENT_SEASON} games`, await programCalendarGames(school.school), new Date()));
}
