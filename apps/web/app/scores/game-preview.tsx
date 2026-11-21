import Link from "next/link";
import type { ReactNode } from "react";
import { mediumDate, type GameDetail, type GamePreview, type PreviewSide } from "@/lib/game-pages";
import { gameDay } from "@/lib/game-day";
import { kickoffTime } from "@/lib/kickoff";
import { signed } from "@/lib/signed";
import { MeetingsList } from "./game-extras";
import { plural } from "@/lib/plural";
import { FIRST_SEASON } from "@/lib/season";

// The preview on a game not yet played (/scores/<id>): both teams side by side, each team's last five games, their games against
// each other since FIRST_SEASON, the opponents both met this season, what comes next and, at a State Championship,
// each team's earlier ones (ADR 0088). Words are rating, projected margin and chance to win, and nothing here
// names a winner or says how a game went: robot-read scores are unconfirmed (ADR 0004, ADR 0013), shown as scores only,
// and a forfeit is the word. `programs` maps a school's name to its program page, for the schools our alignments list.

type Programs = Map<string, string>;

/** A block link at least 44px tall, so it is a real tap target; a school with no program page is plain text. */
function Name({ name, programs, className = "" }: { name: string; programs: Programs; className?: string }) {
  const slug = programs.get(name);
  const base = `flex min-h-11 items-center break-words text-[15px] font-semibold leading-5 ${className}`;
  return slug ? (
    <Link href={`/programs/${slug}`} prefetch={false} className={`${base} text-navy hover:underline`}>
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

/** A team's last games, newest first: each its own page, the other team, and the score with the team's own first. */
function LastGames({ side }: { side: PreviewSide }) {
  return (
    <div>
      <h4 className="pt-2 text-[15px] font-bold leading-5 text-ink">{side.team}</h4>
      <ul>
        {side.last.map((g) => (
          <li key={g.href} className="border-b border-line">
            <Link href={g.href} prefetch={false} className="grid min-h-14 grid-cols-[6.75rem_1fr_auto] items-center gap-x-3 py-1 hover:bg-panel">
              <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{mediumDate(g.date)}</span>
              <span className="min-w-0 text-[15px] leading-5 text-ink">{g.opponent}</span>
              <span className="font-num text-[19px] font-bold tabular-nums text-ink">
                {g.mark && (
                  <>
                    <span aria-hidden="true" className="mr-1.5">{g.mark}</span>
                    <span className="sr-only">{g.mark === "W" ? "Win" : g.mark === "L" ? "Loss" : "Tie"} </span>
                  </>
                )}
                {g.score}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Fri, Nov 27 · 7:00 PM CT": the day, and the kickoff when the league lists one. */
const when = (n: { date?: string; kickoff?: string }) => [n.date && gameDay(n.date), n.kickoff && kickoffTime(n.kickoff)].filter(Boolean).join(" · ");

/** One labelled line of the next game (a plain block, not a list, so the two team cards stay the preview's only definition lists). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mb-1">
      <span className="block text-[13px] uppercase tracking-wide text-muted">{label}</span>
      <span className="block font-semibold text-ink">{children}</span>
    </p>
  );
}

/** The next round: the game after this one, as the league's bracket sets it. Day, kickoff and site only when it lists them. */
function Next({ next, bracket, programs }: { next: NonNullable<GamePreview["next"]>; bracket?: string; programs: Programs }) {
  const [day, site] = [when(next), next.site];
  const label = next.label === "State Championship" ? next.label : `${next.label} round`;
  return (
    <Part id="path" title="Next round">
      <div className="pt-2 text-[15px] leading-5">
        <Row label="Next game">{label}</Row>
        {next.other && <Row label="Against">{next.other.team ? <Name name={next.other.team} programs={programs} /> : <span className="block py-1">{next.other.text[0].toUpperCase() + next.other.text.slice(1)}</span>}</Row>}
        {day && <Row label="When">{day}</Row>}
        {site && <Row label="Where">{site}</Row>}
      </div>
      {bracket && (
        <Link href={bracket} prefetch={false} className="link-more">
          Full bracket
        </Link>
      )}
    </Part>
  );
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** How many earlier State Championships are listed under each team. */
const HISTORY_SHOWN = 5;

/** At a State Championship: each team's earlier ones in its league's list, newest first. Says "on record": the lists begin
 * in 1972 (UIL's archive) and 2018 (the other leagues' recorded finals), so no team is called a first-timer. */
function History({ history }: { history: NonNullable<GamePreview["history"]> }) {
  return (
    <Part id="state-history" title="State Championship history">
      {history.map(({ team, past, titles }) => (
        <div key={team}>
          <h4 className="pt-2 text-[15px] font-bold leading-5 text-ink">{team}</h4>
          {past.length === 0 ? (
            <p className="py-1 text-[15px] leading-5 text-muted">No earlier State Championship on record.</p>
          ) : (
            <>
              <p className="py-1 text-[15px] font-semibold leading-5 text-ink">
                {titles ? count(titles, "state title") : "No state titles"}, {count(past.length, "State Championship appearance")} on record
              </p>
              <ul>
                {past.slice(0, HISTORY_SHOWN).map((a) => (
                  <li key={`${a.season}-${a.bracket}`} className="flex min-h-9 items-baseline gap-x-3 border-b border-line py-1 text-[15px] leading-5 text-ink">
                    <span className="w-12 shrink-0 font-num text-[15px] font-bold text-navy">{a.season}</span>
                    <span className="min-w-0 flex-1">{a.opponent}</span>
                    <span className="font-num font-bold tabular-nums">
                      <span aria-hidden="true" className="mr-1.5">{a.won ? "W" : "L"}</span>
                      <span className="sr-only">{a.won ? "Win" : "Loss"} </span>
                      {a.score ?? "No score listed"}
                    </span>
                  </li>
                ))}
              </ul>
              {past.length > HISTORY_SHOWN && <p className="pt-1 text-[13px] leading-4 text-muted">The latest {HISTORY_SHOWN} of {past.length}.</p>}
            </>
          )}
        </div>
      ))}
    </Part>
  );
}

/** `projected` is the game's own projection text ("Jayton by 12 · 74% chance to win"), undefined when a team is unrated. */
export function GamePreviewSection({ preview, detail, projected, programs, noEdge, series }: { preview: GamePreview; detail: GameDetail; projected?: string; programs: Programs; noEdge?: boolean; series?: string }) {
  const { away, home, common, next, history } = preview;
  const { total, list } = detail.meetings;
  const last = [away, home].filter((s) => s.last.length > 0);
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
      <p className="pt-1 text-[13px] leading-4 text-muted">Away team first. Rank is within the team&rsquo;s organization.</p>
      {projected && (
        <p className="pt-2 text-[17px] font-semibold leading-6 text-ink">
          {projected} <span className="block text-[13px] font-normal leading-4 text-muted">A projection, not a result.</span>
        </p>
      )}
      {projected && (
        <>
          <p className="pt-1 text-[13px] leading-4 text-muted">From both teams&rsquo; ratings. {noEdge ? "It gives neither team a home edge." : "It includes the home edge for the listed home team."}</p>
          <Link href="/rankings/how" prefetch={false} className="link-more">
            How ratings work
          </Link>
        </>
      )}

      {last.length > 0 && (
        <Part id="last-five" title="Last five games">
          {last.map((s) => (
            <LastGames key={s.team} side={s} />
          ))}
          <p className="pt-1 text-[13px] leading-4 text-muted">Newest first. Each team&rsquo;s own score first; W is a win, L a loss.</p>
        </Part>
      )}

      <Part id="head-to-head" title={`Head-to-head since ${FIRST_SEASON}`}>
        {total === 0 ? (
          <p className="py-2 text-[15px] text-muted">No earlier game between these two on record since {FIRST_SEASON}.</p>
        ) : (
          <>
            <p className="pt-2 text-[15px] leading-5 text-ink">
              {total === 1 ? "Met once" : `Met ${total} times`} since {FIRST_SEASON}. Last meeting: {mediumDate(list[0].result.date)}.
            </p>
            <MeetingsList detail={detail} />
          </>
        )}
      </Part>
      {/* The pair's head-to-head page (ADR 0097): every meeting, the series in words, the streak and the biggest wins. Beside the
          region, not in it: the region holds the meetings listed above. */}
      {series && total > 0 && (
        <p>
          <Link href={series} prefetch={false} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-4 hover:text-red">
            All {plural(total, "meeting")}
            <span className="sr-only"> of {away.team} and {home.team}</span>
          </Link>
        </p>
      )}

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
              {common.rest > 0 ? `${common.shown.length} of ${common.shown.length + common.rest} common opponents shown. ` : ""}Each team&rsquo;s own score first.
            </p>
          </>
        )}
      </Part>
      {next && <Next next={next} bracket={preview.bracket} programs={programs} />}
      {history && <History history={history} />}
    </section>
  );
}
