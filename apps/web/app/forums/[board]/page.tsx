import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanSignIn } from "@/lib/auth/config";
import { boardOf } from "@/lib/forum-boards";
import { loadThreads, pageOf, THREADS_PER_PAGE } from "@/lib/forums";
import { PageHeader } from "../../ui";
import { Pager } from "../pager";
import { when } from "../when";
import { NewThread } from "./new-thread";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ board: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const board = boardOf((await params).board);
  return { title: `${board?.name ?? "Forum"} | Forums`, robots: { index: false, follow: false } };
}

export default async function BoardPage({ params, searchParams }: Props) {
  const board = boardOf((await params).board);
  if (!fanSignIn() || !board) notFound();
  const page = pageOf((await searchParams).page);
  const found = await loadThreads(board.slug, page);
  return (
    <section aria-labelledby="board">
      <nav aria-label="Back" className="-mt-2 mb-2">
        <Link href="/forums" className="inline-flex min-h-11 items-center text-[14px] font-semibold text-navy underline underline-offset-2">All boards</Link>
      </nav>
      <PageHeader id="board" eyebrow="Forums" title={board.name} size="md" note={board.description} />
      <div className="mt-5">
        <NewThread board={board.slug} next={`/forums/${board.slug}`} />
      </div>
      <h2 className="mt-6 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">Threads</h2>
      {!found && <p className="py-3 text-[15px] text-muted">Threads could not be loaded right now.</p>}
      {found && found.threads.length === 0 && <p className="py-3 text-[15px] text-muted">{page > 1 ? "No more threads." : "No threads yet. Start the first one."}</p>}
      {found && found.threads.length > 0 && (
        <ul>
          {found.threads.map((t) => (
            <li key={t.id} className="border-b border-line">
              <Link href={`/forums/thread/${t.id}`} className="flex min-h-14 flex-col justify-center py-2 hover:bg-panel">
                <span className="break-words text-[17px] font-bold text-navy">{t.title}</span>
                <span className="text-[13px] text-muted">
                  {t.author} · {t.replies} {t.replies === 1 ? "reply" : "replies"} · last post {when(t.lastPostAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {found && <Pager base={`/forums/${board.slug}`} page={page} total={found.total} per={THREADS_PER_PAGE} />}
    </section>
  );
}
