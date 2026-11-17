import { bracketSlug, loadBrackets } from "@/lib/brackets";
import { bracketCalendarGames } from "@/lib/calendar-games";
import { calendarFile, calendarResponse } from "@/lib/calendar";
import { CURRENT_SEASON } from "@/lib/season";

// A bracket's games this season as a calendar a phone subscribes to (ADR 0095): the games listed and the ones the bracket sets once
// both teams are known. Written at build time.
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = async () => (await loadBrackets()).map((b) => ({ slug: bracketSlug(b.name) }));

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bracket = (await loadBrackets()).find((b) => bracketSlug(b.name) === slug);
  if (!bracket) return new Response("Not found", { status: 404 });
  return calendarResponse(calendarFile(`${bracket.name} ${CURRENT_SEASON} playoffs`, await bracketCalendarGames(bracket.name), new Date()));
}
