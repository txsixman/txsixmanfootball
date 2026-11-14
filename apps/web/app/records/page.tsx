import type { Metadata } from "next";
import { ORGS } from "@/lib/orgs";
import { describeRecords, RecordsView } from "./view";
import { recordsTitle } from "@/lib/titles";

export const dynamic = "force-static";
export async function generateMetadata(): Promise<Metadata> {
  return { title: recordsTitle(ORGS[0].label), description: await describeRecords(ORGS[0]), alternates: { canonical: "/records" } };
}

/** UIL, the default organization; the others are at /records/<org> (ADR 0012). */
export default function RecordsPage() {
  return <RecordsView org={ORGS[0]} />;
}
