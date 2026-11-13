import type { Metadata } from "next";
import { ORGS } from "@/lib/orgs";
import { RecordsView } from "./view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "UIL records" };

/** UIL, the default organization; the others are at /records/<org> (ADR 0012). */
export default function RecordsPage() {
  return <RecordsView org={ORGS[0]} />;
}
