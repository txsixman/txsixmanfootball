import type { Metadata } from "next";
import Link from "next/link";
import { aboutRatingsDescription } from "@/lib/descriptions";
import { FEW_GAMES, MOVE_THRESHOLD } from "@/lib/ratings";
import { PageHeader } from "../../ui";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "About the ratings", description: aboutRatingsDescription() };

// What a rating means and what it rests on, in plain words. Every claim is checked against services/ratings (model.py CAP,
// rows.py) and the ADRs it names; it must stay true to them and to /rankings/how, which says how the fit works. The words are
// rating, projected margin and win probability, never betting terms, and no data source is named (ADR 0010).
const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: "number",
    title: "What the number means",
    body: [
      "A team's rating is how many points better or worse it is than an average team, on a neutral field. Zero is average: the average of the teams listed on this site. A team rated +20 is about 20 points better than that, and a team rated -10 about 10 points worse.",
      "The projected margin between two teams is the difference in their ratings, plus the home-field edge when one of them plays at home.",
    ],
  },
  {
    id: "range",
    title: "The ± and the rank range",
    body: [
      "A rating is an estimate, not a fact. The small ± figure beside it is how far it could be off: it is bigger for a team with few games or lopsided ones. Two teams whose ratings are within that figure of each other cannot be told apart.",
      "The rank range (such as #3 to #13) is the places a team would hold if its rating were that much higher or lower and every other team stayed where it is. Teams whose ranges overlap are grouped in a tier.",
      `Both show only for a team with at least ${FEW_GAMES} rated games. A team with fewer is not ranked (NR), because one result can move its rating a long way. An arrow beside a rank shows only when the rating moved by more than ${MOVE_THRESHOLD} points in a week.`,
    ],
  },
  {
    id: "basis",
    title: "Games played and games rated",
    body: [
      "Under each team on the rankings, and on its program page, are two numbers: the games it has played this season, and how many of them are rated. A rating rests on the rated games only.",
      "A game is played but not rated when it is a forfeit or a game listed twice. Those say nothing about how strong a team is. The difference between the two numbers is how many games were left out. A 0-0 \"final\" that is not a forfeit is no score at all: it counts as a game not yet played.",
      "A rating also rests on some games against schools that are not listed on this site, when that school played at least two listed teams. A program page counts those separately. On a past week's rankings, both numbers count only the games through that Sunday.",
    ],
  },
  {
    id: "rule",
    title: "The 45-point rule",
    body: [
      "A six-man game stops when a team leads by 45 or more points. A game that ended that way says only that the margin was at least 45, not exactly what the board showed. The rating counts it as a win by at least 45, so a bigger score gains a team nothing, and a game that stops early costs it nothing. A game with no reason listed and a margin of 45 or more is counted the same way.",
    ],
  },
  {
    id: "forfeits",
    title: "Forfeits",
    body: [
      "A forfeit counts in a team's win-loss record. It is left out of the rating, because no game was played. A forfeit shows as the word Forfeit, never as a score.",
    ],
  },
  {
    id: "unconfirmed",
    title: "Scores that are not confirmed",
    body: [
      "Scores the site reads automatically, which is almost all of them, are marked unconfirmed until three or more agreeing reports confirm them. Unconfirmed scores still count: they feed the ratings, and they make the win-loss records, standings and brackets. When a score is corrected, all of those change with it.",
      "What an unconfirmed score never does is name a winner. A game's row shows its two scores, marked unconfirmed, and no team is named the winner.",
    ],
  },
];

export default function AboutRatingsPage() {
  return (
    <article aria-labelledby="about-ratings" className="max-w-prose">
      <Link href="/rankings" className="inline-flex min-h-11 items-center font-semibold text-navy underline">
        Back to rankings
      </Link>
      <PageHeader id="about-ratings" size="md" eyebrow="About" title="About the ratings" note="What a rating means, and what it rests on." />
      {SECTIONS.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="mt-8">
          <h2 id={s.id} className="font-num text-[24px] font-bold uppercase tracking-wide text-navy">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="mt-2 text-[16px] text-ink">{p}</p>
          ))}
        </section>
      ))}
      <Link href="/rankings/how" className="mt-8 inline-flex min-h-11 items-center font-semibold text-navy underline">
        How the rankings work, and how well they have predicted past seasons
      </Link>
    </article>
  );
}
