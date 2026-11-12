import type { Metadata } from "next";
import { PlayoffsView } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Playoffs" };

export default function PlayoffsPage() {
  return <PlayoffsView league="UIL" />;
}
