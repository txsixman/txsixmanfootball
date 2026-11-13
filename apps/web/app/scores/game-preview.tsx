import Link from "next/link";
import type { ReactNode } from "react";
import type { GameDetail, GamePreview, PreviewSide } from "@/lib/game-pages";
import { signed } from "@/lib/signed";
import { MeetingsList } from "./game-extras";

// The preview on a game not yet played (/scores/<id>): both teams side by side, their games against each other since
// 2021, and the opponents both met this season. Words are rating, projected margin and win probability, and nothing here
// names a winner or says how a game went: robot-read scores are unconfirmed (ADR 0004, ADR 0013), shown as scores only,
// and a forfeit is the word. `programs` maps a school's name to its program page, for the schools our alignments list.

type Programs = Map<string, string>;

/** A block link at least 44px tall, so it is a real tap target; a school with no program page is plain text. */
function Name({ name, programs, className = "" }: { name: string; programs: Programs; className?: string }) {
  const slug = programs.get(name);
  const base = `flex min-h-11 items-center break-words text-[15px] font-semibold leading-5 ${className}`;
  return slug ? (
    <Link href={`/programs/${slug}`} className={`${base} text-navy hover:underline`}>
      {name}
    </Link>
  ) : (
    <span className={`${base} text-ink`}>{name}</span>
  );
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-4">
      <h3 id={id} className="border-b border-line pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Team({ side, programs }: { side: PreviewSide; programs: Programs }) {
  const dash = (what: string) => (
    <>
      <span aria-hidden="true">&ndash;</span>
      <span className="sr-only">{what}</span>
    </>
  );
  return (
    <div className="min-w-0 border border-line px-2 pb-2">
      <Name name={side.team} programs={programs} />
      <dl className="text-[14px] leading-5">
        <dt className="text-[13px] uppercase tracking-wide text-muted">Record</dt>
        <dd className="mb-1 font-num text-[20px] font-bold tabular-nums leading-6 text-ink">{side.record || dash("no earlier games")}</dd>
        <dt className="text-[13px] uppercase tracking-wide text-muted">Rating</dt>
        <dd className="mb-1 font-num text-[20px] font-bold tabular-nums leading-6 text-ink">{side.rating != null ? signed(side.rating) : dash("not rated")}</dd>
        <dt className="text-[13px] uppercase tracking-wide text-muted">Rank</dt>
        <dd className="font-semibold leading-5 text-ink">
          {side.rank ? side.rank.text : dash("not rated")}
          {side.rank?.sub && <span className="block text-[13px] font-normal text-muted">{side.rank.sub}</span>}
        </dd>
      </dl>
    </div>
  );
}

/** `projected` is the game's own projection text ("Jayton by 12 · 74% win probability"), undefined when a team is unrated. */
export function GamePreviewSection({ preview, detail, projected, programs, since }: { preview: GamePreview; detail: GameDetail; projected?: string; programs: Programs; since: number }) {
  const { away, home, common } = preview;
  const { total } = detail.meetings;
  return (
    <section aria-labelledby="preview" className="mt-5 px-3">
      <h2 id="preview" className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        Preview
      </h2>

      <h3 className="sr-only">The two teams</h3>
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Team side={away} programs={programs} />
        <Team side={home} programs={programs} />
      </div>
      <p className="pt-1 text-[13px] leading-4 text-muted">Away team first. Records are from season scores, not confirmed here. Rank is within the team&rsquo;s organization.</p>
      {projected && (
        <p className="pt-2 text-[17px] font-semibold leading-6 text-ink">
          {projected} <span className="block text-[13px] font-normal leading-4 text-muted">A projection, not a result.</span>
        </p>
      )}

      <Part id="head-to-head" title={`Head-to-head since ${since}`}>
        {total === 0 ? (
          <p className="py-2 text-[15px] text-muted">No earlier game between these two on record since {since}.</p>
        ) : (
          <MeetingsList detail={detail} />
        )}
      </Part>

      <Part id="common-opponents" title="Common opponents this season">
        {common.shown.length === 0 ? (
          <p className="py-2 text-[15px] text-muted">No opponent both teams have played this season.</p>
        ) : (
          <>
            <ul>
              {common.shown.map((c) => (
                <li key={c.opponent} className="border-b border-line">
                  <Name name={c.opponent} programs={programs} />
                  <p className="flex flex-wrap gap-x-3 pb-2 font-num text-[17px] font-semibold leading-6 tabular-nums text-ink">
                    <span>
                      {away.team} {c.a.join(", ")}
                    </span>
                    <span aria-hidden="true" className="text-muted">&middot;</span>
                    <span>
                      {home.team} {c.b.join(", ")}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="pt-1 text-[13px] leading-4 text-muted">
              {common.rest > 0 ? `${common.shown.length} of ${common.shown.length + common.rest} common opponents shown. ` : ""}Each team&rsquo;s own score first. Scores are not confirmed here and may change.
            </p>
          </>
        )}
      </Part>
    </section>
  );
}
