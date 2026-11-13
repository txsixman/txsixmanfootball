import type { Metadata } from "next";
import { ORGS } from "@/lib/orgs";
import { describeRecords, RecordsView } from "./view";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "UIL records", description: await describeRecords(ORGS[0]) };
}

/** UIL, the default organization; the others are at /records/<org> (ADR 0012). */
export default function RecordsPage() {
  return <RecordsView org={ORGS[0]} />;
}
