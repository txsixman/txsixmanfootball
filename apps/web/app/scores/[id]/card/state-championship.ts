import { stateChampionships, type StateChampionship } from "@/lib/state-championships";
import { CURRENT_SEASON } from "@/lib/season";

/** The State Championship this season's game page is (bracket, teams, and the champion once recorded), if it is one. Only the
 * season under way has State Championship pages. */
export const stateChampionshipOf = async (id: string): Promise<StateChampionship | undefined> =>
  (await stateChampionships(CURRENT_SEASON)).find((c) => c.gameHref === `/scores/${id}`);
