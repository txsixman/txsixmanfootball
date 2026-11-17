"use client";

import Link from "next/link";
import type { MyGame, MyTeam } from "@/lib/my-teams";
import { lead } from "@/lib/program-games";
import { Crest } from "../programs/crest";
import { planTonight } from "@/lib/save-tonight";
import { AlertsToggle } from "./alerts-toggle";
import { SavedTonight } from "./saved-tonight";
import { LiveRead, ProgramLiveScore } from "../scores/live-game";

/** One game line: "Last" or "Next", date, opponent, and the score or the projection. A playoff game links to its page.
 * `school`: for the next game, whose live score then shows in place while it is under way (ADR 0039): the status line
 * says Live (or Final, ADR 0043) and the score sits where a final's would, from the school's side. */
function Line({ label, game, school }: { label: string; game: MyGame; school?: string }) {
  const live = school && game.date && !game.score ? { date: game.date, school, opponent: game.opponent, home: game.home } : null;
  const line = (
    <span className="block">
      {game.status} · {lead(game)}{" "}
      {game.opponentSlug && !game.href ? (
        <Link href={`/programs/${game.opponentSlug}`} prefetch={false} className="name-link">
          {game.opponent}
        </Link>
      ) : (
        game.opponent
      )}
    </span>
  );
  const body = (
    <>
      <span className="w-11 shrink-0 text-[13px] font-bold uppercase tracking-wider text-red">{label}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink">
        {line}
        {game.note && <span className="block text-[13px] leading-4 text-muted">{game.note}</span>}
        {/* While under way, the live line; the projection stays beside it (ADR 0044). */}
        {live && <ProgramLiveScore {...live} line />}
        {game.projected && <span className="block text-[13px] leading-4 text-muted">{game.projected}</span>}
      </span>
      {game.score && <span className="shrink-0 font-num text-[20px] font-bold tabular-nums text-ink">{game.score}</span>}
      {live && (
        <span className="shrink-0 font-num text-[20px] font-bold tabular-nums text-ink">
          <ProgramLiveScore {...live} />
        </span>
      )}
    </>
  );
  const layout = "flex min-h-11 items-center gap-2 py-1";
  return game.href ? (
    <Link href={game.href} className={`${layout} hover:bg-panel`}>
      {body}
    </Link>
  ) : (
    <div className={layout}>{body}</div>
  );
}

/** The "My teams" section for the programs found (see block.tsx, which asks which and loads this only when there are some, ADR 0100). */
export default function MyTeamsView({ teams }: { teams: MyTeam[] }) {
  // On a followed team's game day, tonight's pages are saved on this phone for no signal (ADR 0096).
  const tonight = planTonight(teams.flatMap((t) => (t.next ? [t.next] : [])));
  return (
    <section aria-labelledby="my-teams" data-pagefind-ignore className="mt-6">
      <h2 id="my-teams" className="section-title">My teams</h2>
      {/* Game alerts for the followed teams, only while the site switch is on (renders nothing otherwise). */}
      <AlertsToggle />
      {tonight.onTonight && <SavedTonight urls={tonight.urls} />}
      {/* One live read for the followed programs' next games, asked only while one may be under way (lib/kickoff.ts). */}
      <LiveRead games={teams.flatMap((t) => (t.next?.date && !t.next.score ? [{ date: t.next.date, kickoff: t.next.kickoff }] : []))}>
        <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {teams.map((t) => (
            <li key={t.slug} className="border-b border-line pb-1">
              <Link href={`/programs/${t.slug}`} prefetch={false} className="flex min-h-11 items-center gap-2 text-ink hover:text-navy hover:underline">
                <Crest school={t.school} identity={t.crest} size={28} decorative />
                <span className="min-w-0 flex-1 truncate font-num text-[20px] font-bold uppercase tracking-wide">{t.school}</span>
                {t.record && (
                  <span className="font-num text-[20px] font-bold tabular-nums text-navy">
                    {t.record}
                    <span className="sr-only"> this season</span>
                  </span>
                )}
              </Link>
              {t.last && <Line label="Last" game={t.last} />}
              {t.next && <Line label="Next" game={t.next} school={t.school} />}
              {!t.last && !t.next && <p className="py-1 text-[14px] text-muted">No games on record yet.</p>}
            </li>
          ))}
        </ul>
      </LiveRead>
    </section>
  );
}
