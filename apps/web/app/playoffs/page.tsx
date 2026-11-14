import type { Metadata } from "next";
import { describePlayoffs, PlayoffsView } from "./view";
import { playoffsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: playoffsTitle({ league: "UIL", season: CURRENT_SEASON, past: false }), description: await describePlayoffs("UIL"), alternates: { canonical: "/playoffs" } };
}

export default function PlayoffsPage() {
  return <PlayoffsView league="UIL" />;
}
