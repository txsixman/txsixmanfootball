import { calendarFile, calendarResponse } from "@/lib/calendar";
import { upcomingCalendarGames } from "@/lib/calendar-games";

// One game as a calendar file (ADR 0095), for a game still to play with a date: the game page's "Add to calendar".
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = async () => (await upcomingCalendarGames()).map((g) => ({ id: g.id }));

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = (await upcomingCalendarGames()).find((g) => g.id === id);
  if (!game) return new Response("Not found", { status: 404 });
  return calendarResponse(calendarFile(`${game.away} vs ${game.home}`, [game], new Date()));
}
