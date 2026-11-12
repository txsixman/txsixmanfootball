import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { fanSignIn } from "@/lib/auth/config";
import { loadThread, pageOf, POSTS_PER_PAGE } from "@/lib/forums";
import { Pager } from "../../pager";
import { ThreadView } from "./thread-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Thread | Forums", robots: { index: false, follow: false } };

export default async function ThreadPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!fanSignIn() || !z.uuid().safeParse(id).success) notFound();
  const page = pageOf((await searchParams).page);
  const found = await loadThread(id, page);
  if (!found) notFound();
  const { info, posts } = found;
  return (
    <section aria-labelledby="thread">
      <nav aria-label="Back" className="-mt-2 mb-2">
        <Link href={`/forums/${info.board}`} className="inline-flex min-h-11 items-center text-[14px] font-semibold text-navy underline underline-offset-2">{info.boardName}</Link>
      </nav>
      <h1 id="thread" className="break-words font-num text-[36px] font-bold uppercase leading-none tracking-wide text-navy">{info.title}</h1>
      <p className="mt-1 text-[13px] text-muted">{info.total} {info.total === 1 ? "post" : "posts"}</p>
      <ThreadView key={`${page}-${info.total}`} threadId={id} initial={posts} replyPage={Math.ceil((info.total + 1) / POSTS_PER_PAGE)} next={`/forums/thread/${id}${page > 1 ? `?page=${page}` : ""}`} />
      <Pager base={`/forums/thread/${id}`} page={page} total={info.total} per={POSTS_PER_PAGE} />
    </section>
  );
}
