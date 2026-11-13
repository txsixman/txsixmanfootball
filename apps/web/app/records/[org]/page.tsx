import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { describeRecords, RecordsView } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ org: string }> };

export const generateStaticParams = orgParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const org = orgBySlug((await params).org);
  return { title: `${org?.label} records`, ...(org && { description: await describeRecords(org) }) };
}

export default async function OrgRecordsPage({ params }: Props) {
  const org = orgBySlug((await params).org);
  if (!org) notFound();
  return <RecordsView org={org} />;
}
