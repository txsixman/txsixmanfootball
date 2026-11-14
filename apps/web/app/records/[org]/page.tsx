import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { describeRecords, RecordsView } from "../view";
import { recordsTitle } from "@/lib/titles";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ org: string }> };

export const generateStaticParams = orgParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const org = orgBySlug((await params).org);
  return { title: org ? recordsTitle(org.label) : "Records", ...(org && { description: await describeRecords(org), alternates: { canonical: `/records/${org.slug}` } }) };
}

export default async function OrgRecordsPage({ params }: Props) {
  const org = orgBySlug((await params).org);
  if (!org) notFound();
  return <RecordsView org={org} />;
}
