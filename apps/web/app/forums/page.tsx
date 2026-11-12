import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fanSignIn } from "@/lib/auth/config";
import { BOARDS } from "@/lib/forum-boards";
import { loadBoards } from "@/lib/forums";
import { PageHeader } from "../ui";
import { when } from "./when";

// The forums: a few fixed boards. Read by anyone; posting needs a signed-in account (the boards' pages). Per request and
// noindex for now (proxy.ts sends the same header).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forums", robots: { index: false, follow: false } };

export default async function ForumsPage() {
  if (!fanSignIn()) notFound();
  const counts = new Map((await loadBoards())?.map((b) => [b.slug, b]) ?? []);
  return (
    <section aria-labelledby="forums">
      <PageHeader
        id="forums"
        eyebrow="Community"
        title="Forums"
        note="Talk Texas six-man football. Plain text only, no direct messages. Anyone can read; sign in to post."
      />
      <ul className="mt-6 border-t-2 border-navy">
        {BOARDS.map((b) => {
          const row = counts.get(b.slug);
          return (
            <li key={b.slug} className="border-b border-line">
              <Link href={`/forums/${b.slug}`} className="flex min-h-14 flex-col justify-center px-3 py-2 hover:bg-panel">
                <span className="text-[18px] font-bold text-navy">{b.name}</span>
                <span className="text-[14px] text-muted">{b.description}</span>
                {row && (
                  <span className="text-[13px] text-muted">
                    {row.threads} {row.threads === 1 ? "thread" : "threads"}
                    {row.lastPostAt ? ` · last post ${when(row.lastPostAt)}` : ""}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
