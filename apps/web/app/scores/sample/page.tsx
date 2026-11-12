import type { Metadata } from "next";
import { demoGames } from "@/lib/demo-games";
import Board from "../board";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Sample scoreboard | Project 80x40" };

export default function SampleScoresPage() {
  return <Board games={demoGames} eyebrow="Sample scoreboard. Invented schools." title="Tonight" />;
}
