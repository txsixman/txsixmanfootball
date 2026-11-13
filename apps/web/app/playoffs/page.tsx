import type { Metadata } from "next";
import { describePlayoffs, PlayoffsView } from "./view";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Playoffs", description: await describePlayoffs("UIL"), alternates: { canonical: "/playoffs" } };
}

export default function PlayoffsPage() {
  return <PlayoffsView league="UIL" />;
}
