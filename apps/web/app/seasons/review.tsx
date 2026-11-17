import Link from "next/link";
import type { ReactNode } from "react";
import type { Alignment } from "@/lib/alignments";
import { programFor } from "@/lib/alignments";
import { EMPTY, type Identity } from "@/lib/identity";
import { chanceText } from "@/lib/projection";
import { signed, ratingText } from "@/lib/ratings";
import type { Org } from "@/lib/orgs";
import { roundName, RECORD_MIN_GAMES, STREAK_MIN } from "@/lib/season-review";
import type { SeasonReview } from "@/lib/season-review-load";
import type { SeasonResult } from "@/lib/season-results";
import { marginOf } from "@/lib/week-review";
import { BoardRow, CrestSlot } from "../ui";

// One organization's season in review (ADR 0099): every line is counted from the data (lib/season-review.ts), none is
// written, and a fact the data cannot support is left out. A final score is confirmed (ADR 0040), so a result may name its
// winner, but no row says "winner" or "leading" (the words of a game under way). Each line links to its game or program.
// "Upset" is allowed here as it is on the week's recap (ADR 0092, extended by ADR 0099). Pure server rendering.

// A team link is a block (flex), never an inline link inside a line of text: axe's link-in-text-block rule would ask for an
// underline on a link that sits beside other text of its own colour. Its crest is inside the link (e2e/crests.spec.ts).
const LINK = "flex min-h-11 min-w-11 items-center hover:text-navy hover:underline";

type Identities = ReadonlyMap<string, Identity>;

function TeamLink({ name, org, alignments, identities, bold = true }: { name: string; org: Org; alignments: Alignment[]; identities: Identities; bold?: boolean }) {
  const slug = programFor(alignments, name, org.league)?.slug;
  const cls = bold ? "font-semibold" : "";
  const crest = <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />;
  return slug ? (
    <Link href={`/programs/${slug}`} prefetch={false} className={`${LINK} ${cls} text-ink`}>
      {crest}
      {name}
    </Link>
  ) : (
    <span className={`flex min-h-11 items-center ${cls}`}>
      {crest}
      {name}
    </span>
  );
}

/** "Final: Oglesby by 52", or "Final: tied" for a tie. */
const finalLine = (g: SeasonResult) => (g.homeScore === g.awayScore ? "Final: tied" : `Final: ${g.homeScore > g.awayScore ? g.home : g.away} by ${marginOf(g)}`);

/** Away team, home team and the score, as one link to the game's page. A forfeit shows the word, never the recorded score. The
 * link's name is its own text plus hidden separators, never an aria-label, so what is read starts with what is seen (axe's
 * label-content-name-mismatch). */
function GameLink({ g }: { g: SeasonResult }) {
  const line = (team: string, score: number) => (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0 break-words">{team}</span>{" "}
      <span className="font-num text-[18px] font-bold tabular-nums">{g.forfeit ? "" : score}</span>
    </span>
  );
  return (
    <Link
      href={g.href}
      prefetch={false}
      className="block min-h-11 py-0.5 text-ink hover:text-navy"
    >
      {line(g.away, g.awayScore)}
      <span className="sr-only">, </span>
      {line(g.home, g.homeScore)}
      {g.forfeit && <span className="block text-[13px] font-semibold text-muted"><span className="sr-only">, </span>Forfeit</span>}
      <span className="sr-only">, game page</span>
    </Link>
  );
}

const Sub = ({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) => (
  <div className="mt-5">
    <h4 id={id} className="mx-3 border-b-2 border-navy pb-1 font-num text-[15px] font-bold uppercase tracking-wider text-navy">{title}</h4>
    {note && <p className="px-3 pt-1 text-[13px] leading-[1.35] text-muted">{note}</p>}
    {children}
  </div>
);

const Note = ({ children }: { children: ReactNode }) => <p className="border-b border-line px-3 py-3 text-[15px] leading-6 text-ink">{children}</p>;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const recordText = (r: { won: number; lost: number; tied: number }) => `${r.won}-${r.lost}${r.tied ? `-${r.tied}` : ""}`;

/** The most firsts listed: State Championship games first, then playoff wins by team name. */
const FIRSTS_SHOWN = 12;
const FIRSTS: Record<string, string> = {
  "state-game": "First State Championship game in the records held here",
  "playoff-win": "First playoff win in the results held here",
};

export function SeasonInReview({ review, alignments, identities, latest }: { review: SeasonReview; alignments: Alignment[]; identities: Identities; latest: boolean }) {
  const { org, season, totals } = review;
  const id = `org-${org.slug}-review`;
  const team = (name: string, bold = true) => <TeamLink name={name} org={org} alignments={alignments} identities={identities} bold={bold} />;
  const so = latest ? " so far" : "";

  return (
    <div className="mt-8">
      <h3 id={id} className="px-3 font-num text-[16px] font-bold uppercase tracking-wider text-navy">{latest ? "Season in review, so far" : "Season in review"}</h3>
      <p className="px-3 text-[13px] leading-[1.35] text-muted">
        {org.label} {season}, counted from the games, ratings and playoff results{latest ? ", with the season still under way" : ""}. A forfeit counts as a win or a loss in a
        record or a run, never in a margin; a disputed final is left out of every list that needs a result.
      </p>

      <Sub id={`${id}-champions`} title={review.champions.length === 1 ? "State Champion" : "State Champions"}>
        {review.champions.length ? (
          <ul>
            {review.champions.map((c) => (
              <li key={`${c.label}-${c.champion}`} className="border-b border-line px-3 py-1">
                {c.label && <p className="font-num text-[13px] font-bold uppercase tracking-widest text-red">{c.label}</p>}
                <p className="flex items-center justify-between gap-3 text-[15px]">
                  <span className="min-w-0">
                    <span className="sr-only">Champion: </span>
                    {team(c.champion)}
                  </span>
                  {c.game ? (
                    <Link href={c.game.href} prefetch={false} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-end font-num text-[20px] font-bold tabular-nums text-navy hover:underline">
                      <span className="sr-only">{c.champion} </span>
                      {c.score}
                      <span className="sr-only">, State Championship game page</span>
                    </Link>
                  ) : (
                    <span className="shrink-0 font-num text-[20px] font-bold tabular-nums text-navy">{c.score}</span>
                  )}
                </p>
                <p className="flex items-center text-[14px] text-muted">
                  <span className="pr-2">Runner-up</span>
                  {team(c.runnerUp, false)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Note>{latest ? `No ${org.label} State Champion is recorded yet this season.` : `No ${org.label} State Championship is recorded for ${season}.`}</Note>
        )}
      </Sub>

      {review.best.length > 0 && (
        <Sub
          id={`${id}-records`}
          title="Unbeaten teams and best records"
          note={`The share of games won (a tie counts half), teams with at least ${RECORD_MIN_GAMES} games. A tie is not a loss.`}
        >
          <p className="px-3 pt-2 text-[15px] font-semibold text-ink">
            {review.unbeaten.length
              ? `${plural(review.unbeaten.length, "team")} ${latest ? "are unbeaten so far" : "finished the season unbeaten"}.`
              : `No team ${latest ? "is unbeaten so far" : "finished the season unbeaten"}.`}
          </p>
          <ol aria-labelledby={`${id}-records`} className="mt-1 border-t border-line">
            {review.best.map((r, i) => (
              <BoardRow key={r.team} place={i + 1} figure={recordText(r)} unit="wins and losses">
                {team(r.team)}
                <span className="block truncate text-[13px] text-muted">{r.games} games{r.lost === 0 ? " · unbeaten" : ""}</span>
              </BoardRow>
            ))}
          </ol>
        </Sub>
      )}

      {review.upsets.length > 0 && (
        <Sub
          id={`${id}-upsets`}
          title="Biggest upsets"
          note={`Games the team with the lower chance to win won, by the ratings at the end of the week before, lowest chance first. ${plural(review.upsetCount, "game")} went that way${so}${review.upsetCount > review.upsets.length ? `; the ${review.upsets.length} lowest are shown` : ""}.`}
        >
          <ol aria-labelledby={`${id}-upsets`} className="mt-1 border-t border-line">
            {review.upsets.map((u, i) => (
              <BoardRow key={u.game.id} place={i + 1} figure={chanceText(u.chance)} unit="chance to win before the game">
                <GameLink g={u.game} />
                <span className="block pb-1 text-[13px] text-muted">
                  {u.game.status}. {u.winner} had a {chanceText(u.chance)} chance to win. {finalLine(u.game)}.
                </span>
              </BoardRow>
            ))}
          </ol>
        </Sub>
      )}

      {review.close.length > 0 && (
        <Sub
          id={`${id}-close`}
          title="Closest playoff games"
          note="Playoff games decided by one score or less (eight points or fewer, a touchdown and a two-point conversion), closest first."
        >
          <ol aria-labelledby={`${id}-close`} className="mt-1 border-t border-line">
            {review.close.map((c, i) => (
              <BoardRow key={c.result.id} place={i + 1} figure={c.margin} unit="points apart">
                <GameLink g={c.result} />
                <span className="block pb-1 text-[13px] text-muted">
                  {roundName(c.game.round)}. {c.result.status}. {finalLine(c.result)}.
                </span>
              </BoardRow>
            ))}
          </ol>
        </Sub>
      )}

      {review.streaks.length > 0 && (
        <Sub
          id={`${id}-streaks`}
          title="Longest winning streaks"
          note={`Runs of ${STREAK_MIN} or more wins in a row inside the season, each team's longest. A tie or a loss ends a run.`}
        >
          <ol aria-labelledby={`${id}-streaks`} className="mt-1 border-t border-line">
            {review.streaks.map((s, i) => (
              <BoardRow key={s.team} place={i + 1} figure={s.length} unit="wins in a row">
                {team(s.team)}
                <span className="block text-[13px] text-muted">
                  Won {s.length} games in a row{s.open ? (latest ? ", and the run is still going" : ", through the end of its season") : ""}
                </span>
              </BoardRow>
            ))}
          </ol>
        </Sub>
      )}

      {(review.highest || review.risers.length > 0) && (
        <Sub
          id={`${id}-ratings`}
          title={latest ? "Highest rated and biggest risers" : "Highest rated at the end and biggest risers"}
          note={`${org.label} teams only. The change in rating from the end of week 4 to ${latest ? "now" : "the end of the season"}, for teams with at least three rated games at week 4 and four at the end.`}
        >
          {review.highest && (
            <p className="flex items-center justify-between gap-3 border-b border-line px-3 py-1 text-[15px]">
              <span className="min-w-0">
                <span className="block text-[13px] text-muted">{latest ? "Highest rated now" : "Highest rated at the end of the season"}</span>
                {team(review.highest.team)}
              </span>
              <span className="shrink-0 text-right font-num text-[20px] font-bold text-navy">
                {ratingText(review.highest)}
                <span className="sr-only"> rating</span>
              </span>
            </p>
          )}
          {review.risers.length > 0 && (
            <ol aria-label="Biggest risers" className="border-t border-line">
              {review.risers.map((r, i) => (
                <BoardRow key={r.team} place={i + 1} figure={signed(r.change)} unit="rating points since week 4">
                  {team(r.team)}
                  <span className="block text-[13px] text-muted">Rating {signed(r.rating)}, was {signed(r.was)} after week 4</span>
                </BoardRow>
              ))}
            </ol>
          )}
        </Sub>
      )}

      {review.milestones.length > 0 && (
        <Sub
          id={`${id}-firsts`}
          title="Firsts"
          note="In the data held here: playoff games and State Championship games since 2018 (UIL's State Championship games since 1972)."
        >
          <ul>
            {review.milestones.slice(0, FIRSTS_SHOWN).map((m) => (
              <li key={`${m.kind}-${m.team}`} className="border-b border-line px-3 py-1">
                {team(m.team)}
                <span className="block text-[13px] text-muted">{FIRSTS[m.kind]}</span>
                <GameLink g={m.game} />
              </li>
            ))}
          </ul>
          {review.milestones.length > FIRSTS_SHOWN && <p className="px-3 py-2 text-[13px] text-muted">{plural(review.milestones.length - FIRSTS_SHOWN, "more first")} not listed.</p>}
        </Sub>
      )}

      <Sub id={`${id}-totals`} title="Totals">
        <Note>
          {plural(totals.games, "game")}{so} with {org.label} teams
          {totals.forfeits ? `, ${plural(totals.forfeits, "forfeit")}` : ", no forfeits"}
          {totals.averageMargin !== undefined ? `. The average margin was ${totals.averageMargin.toFixed(1)} points over ${plural(totals.played, "game")} played.` : "."}
        </Note>
      </Sub>
    </div>
  );
}
