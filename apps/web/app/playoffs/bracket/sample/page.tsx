import type { Metadata } from "next";
import { demoTree, DEMO_INFO } from "@/lib/demo-bracket";
import { PageHeader } from "../../../ui";
import { BracketBoard } from "../../tree/board";
import { buildTree } from "../../tree/data";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Sample bracket", robots: { index: false } };

// The bracket drawing (ADR 0049) with invented schools (lib/demo-bracket.ts): finals, a forfeit, a disputed final, a bye,
// games listed and not, projections. Nothing on it changes on its own, so the screenshot tests compare it whole.
export default function SampleBracketPage() {
  const data = buildTree("Sample bracket", "Sample", demoTree(), (n) => DEMO_INFO[n.id] ?? {}, () => undefined);
  return (
    <section aria-labelledby="bracket">
      <PageHeader id="bracket" size="md" eyebrow="Sample bracket. Invented schools." title="Sample bracket" />
      <BracketBoard data={data} imageBase={null} list={false} />
    </section>
  );
}
