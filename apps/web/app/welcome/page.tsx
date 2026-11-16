import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { welcomeDescription } from "@/lib/descriptions";
import { welcomeJsonLd } from "@/lib/json-ld";
import { welcomeTitle } from "@/lib/titles";
import { listWords, WELCOME_SEEN_SCRIPT, welcomeNumbers } from "@/lib/welcome";
import { JsonLd } from "../json-ld";
import { FanAccountsLine } from "./fan-accounts-line";
import { loadWelcome, WELCOME_ORGS } from "./facts";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const f = await loadWelcome();
  return { title: welcomeTitle(), description: welcomeDescription(f.programs, WELCOME_ORGS), alternates: { canonical: "/welcome" } };
}

// The landing page (ADR 0084): where a first-time visitor or a shared link lands. In under a minute it says what the site is
// and sends them on: to their team, or to tonight's scores. Every number and the round line come from the data when the site
// is built (./facts.ts); nothing here is typed in but the words. Home (/) stays the scoreboard. The words are rating,
// projected margin and chance to win only, no source is named (ADR 0010), and the last round is the State Championship.

const card = "flex h-full min-h-11 flex-col border border-line bg-panel px-4 py-3 hover:border-navy";
const cardTitle = "flex items-center justify-between gap-2 font-num text-[22px] font-bold uppercase leading-tight tracking-wide text-navy";

export default async function WelcomePage() {
  const f = await loadWelcome();
  const what = [
    {
      href: "/scores",
      title: "Live scores",
      body: `Scores through every game night, updated while the games are on, every final score, and a page for every game since ${f.firstSeason}.`,
    },
    {
      href: "/rankings",
      title: "Computer rankings",
      body: "A rating for every team from every score, and for each game still to play a projected margin and each team's chance to win.",
    },
    {
      href: "/playoffs",
      title: "Brackets for every league",
      body: `${f.brackets}: each bracket round by round, filling in as games finish, with each team's chance at a title.`,
    },
    {
      href: "/programs",
      title: "Every program's page",
      body: `All ${f.programs} programs: rank, schedule, results back to ${f.firstSeason}, most-played opponents and every state title, merged schools' too.`,
    },
    {
      href: "/championships",
      title: "State Championships",
      body: `Every UIL six-man State Championship game since ${f.firstFinal}, Division I and II, with the programs that have won the most.`,
    },
  ];

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: WELCOME_SEEN_SCRIPT }} />
      <JsonLd data={welcomeJsonLd(welcomeDescription(f.programs, WELCOME_ORGS))} />

      {/* The hero: the navy of the header carried down, edge to edge on a phone (main's px-4 and py-6, app/layout.tsx). */}
      <section aria-labelledby="welcome" className="-mx-4 -mt-6 bg-band px-4 pt-6 pb-8 text-white sm:mx-0 sm:mt-0 sm:px-8 sm:pt-8">
        <p className="text-[12px] font-bold uppercase tracking-widest text-white/80">Texas six-man football · Free, no sign-in</p>
        <h1 id="welcome" className="mt-1 font-num text-[44px] font-bold uppercase leading-[0.95] tracking-wide sm:text-[64px]">
          Every team. Every game.
        </h1>
        <p className="mt-3 max-w-prose text-[17px] leading-6">
          Scores, rankings, playoff brackets and State Championships for all {f.programs} six-man programs in {listWords(WELCOME_ORGS)}, in one place.
        </p>
        {f.roundGames > 0 ? (
          <Link href="/playoffs/this-round" className="mt-3 inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold underline underline-offset-4">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-alert" />
            {f.live}
          </Link>
        ) : (
          <p className="mt-3 flex min-h-11 items-center gap-2 text-[15px] font-semibold">{f.live}</p>
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link href="/programs" className="btn-red w-full text-[17px] sm:w-auto">
            Find your team
          </Link>
          <Link href="/scores/tonight" className="inline-flex min-h-11 w-full items-center justify-center border-2 border-white px-4 text-[17px] font-bold text-white hover:underline sm:w-auto">
            Tonight&rsquo;s scores
          </Link>
        </div>
      </section>

      <section aria-labelledby="whats-here" className="mt-8">
        <h2 id="whats-here" className="section-title">What&rsquo;s here</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {what.map((w) => (
            <li key={w.href}>
              <Link href={w.href} prefetch={false} className={card}>
                <span className={cardTitle}>
                  {w.title}
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
                </span>
                <span className="mt-1 text-[15px] leading-5 text-ink">{w.body}</span>
              </Link>
            </li>
          ))}
          <li>
            <a href="#alerts" className={card}>
              <span className={cardTitle}>
                Follow your teams
                <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
              </span>
              <span className="mt-1 text-[15px] leading-5 text-ink">
                Score alerts on your phone for the teams you follow, and their record, last game and next game on the home page. No account needed.
                <FanAccountsLine />
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section aria-labelledby="numbers" className="mt-8">
        <h2 id="numbers" className="section-title">By the numbers</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {welcomeNumbers(f).map((n) => (
            <div key={n.label} className="flex flex-col-reverse border-t-4 border-red bg-panel px-3 py-2">
              <dt className="text-[14px] leading-5 text-muted">{n.label}</dt>
              <dd className="font-num text-[36px] font-bold leading-none tabular-nums text-navy">{n.value}</dd>
            </div>
          ))}
        </dl>
        <p className="section-note">As of the latest update. Ratings, projected margins and chances to win are estimates.</p>
      </section>

      <section aria-labelledby="alerts" className="mt-8 scroll-mt-4">
        <h2 id="alerts" className="section-title">Get alerts for your team</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            { title: "Find your team", body: "Open Programs and type the school or town." },
            { title: "Tap the alert button", body: "On the team's page, under Score alerts, tap the button to follow it on this phone." },
            { title: "Allow notifications", body: "When your phone asks, say yes. A new final score of your team's comes to you as an alert." },
          ].map((s, i) => (
            <li key={s.title} className="flex gap-3 border-b border-line pb-3">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-band font-num text-[20px] font-bold text-white">{i + 1}</span>
              <span className="min-w-0 text-[15px] leading-5 text-ink">
                <span className="block font-bold">{s.title}</span>
                {s.body}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 border-2 border-navy px-3 py-2">
          <p className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">On iPhone or iPad: Home Screen first</p>
          <p className="mt-1 text-[15px] leading-5 text-ink">
            iPhones show alerts only from a site on the Home Screen. In Safari, tap Share, then Add to Home Screen. Open the site from that
            icon, then follow your team there.
          </p>
        </div>
      </section>

      <section aria-labelledby="start" className="mt-10 border-t-4 border-red pt-6 text-center">
        <h2 id="start" className="font-num text-[32px] font-bold uppercase leading-none tracking-wide text-navy">Find your team</h2>
        <p className="mx-auto mt-2 max-w-prose text-[15px] text-ink">
          {f.programs} programs in {listWords(WELCOME_ORGS)}, each with its scores, rank and history.
        </p>
        <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/programs" className="btn-red w-full sm:w-auto">
            Find your team
          </Link>
          <Link href="/" className="btn w-full sm:w-auto">
            Go to the scoreboard
          </Link>
        </div>
      </section>
    </>
  );
}
