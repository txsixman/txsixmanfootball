import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveLeaders } from "@/lib/leaders-load";
import { describeLeaders, LeadersView } from "./view";

export const dynamic = "force-static";

/** All of UIL, the latest season; every other page is /leaders/<view>, /leaders/<season> or /leaders/<season>/<view> (ADR 0101). */
export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveLeaders([]);
  return page ? { ...describeLeaders(page), alternates: { canonical: "/leaders" } } : {};
}

export default async function LeadersPage() {
  const page = await resolveLeaders([]);
  if (!page) notFound();
  return <LeadersView {...page} />;
}
