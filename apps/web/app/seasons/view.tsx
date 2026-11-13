import Link from "next/link";
import type { ReactNode } from "react";
import { loadAlignments } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { finalLinker, type Linker } from "@/lib/final-linker";
import { finalScore } from "@/lib/champions";
import { loadLineage, successorOf } from "@/lib/lineage";
import { orgHref, type Org } from "@/lib/orgs";
import { signed } from "@/lib/ratings";
import { LEADER_MIN_GAMES } from "@/lib/season-leaders";
import { coverageLine } from "@/lib/season-coverage";
import { type HubLeader, type OrgHub, type SeasonHub } from "@/lib/season-hub";
import { indexHref, weekHref as reviewHref } from "@/lib/week-review-hrefs";
import { weekLabel } from "@/lib/weeks";
import { seasonHref as rankingsHref } from "../rankings/view";
import { seasonHref as resultsHref, weekHref } from "../results/paths";
import { BoardRow, CrestSlot, PageHeader, SectionBar } from "../ui";

// A season's hub (/seasons/<year>): everything the site has for one season, one organization at a time (ADR 0012). Scores
// are robot-read and not confirmed here (ADR 0004), so the page names no game's winner; the state finals are UIL's official
// results. Pure server rendering: no client script.

const LINK = "inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline underline-offset-2 hover:text-ink";
const PILL = "inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-navy px-3 font-num text-[15px] font-bold uppercase tracking-wide text-navy hover:bg-panel";

const seasonId = (org: Org) => `org-${org.slug}`;

const oneDecimal = (n: number) => n.toFixed(1);

/** The seasons newest first, each a link to its page. */
export function SeasonList({ hubs }: { hubs: SeasonHub[] }) {
  return (
    <ol className="mt-4 border-t border-line">
      {hubs.map((h) => (
        <li key={h.season} className="border-b border-line">
          <Link href={`/seasons/${h.season}`} className="flex min-h-14 items-center justify-between gap-3 px-3 py-1 hover:bg-panel">
            <span className="min-w-0">
              <span className="block font-num text-[28px] font-bold leading-8 text-navy">{h.season}</span>
              <span className="block text-[14px] leading-5 text-muted">
                {h.games.toLocaleString("en-US")} games · {h.orgs.map((o) => o.org.label).join(", ")}
                {h.latest && " · under way"}
              </span>
            </span>
            <span aria-hidden="true" className="font-num text-[18px] text-navy">&rsaquo;</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

type Props = { hub: SeasonHub };

function TeamLine({ name, slug, identities }: { name: string; slug?: string; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  const crest = <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />;
  return slug ? (
    <Link href={`/programs/${slug}`} prefetch={false} className="flex min-h-11 items-center font-semibold leading-tight hover:text-navy hover:underline">
      {crest}
      {name}
    </Link>
  ) : (
    <b className="flex min-h-11 items-center leading-tight">
      {crest}
      {name}
    </b>
  );
}

/** A state-final team: its crest and name, a link to its program when it has one, and "now X" for a merged school. */
function FinalTeam({ name, l }: { name: string; l: ReturnType<Linker> }) {
  const body = (
    <>
      <CrestSlot school={name} identity={l.identity} />
      {name}
      {l.now && <span className="ml-2 text-[13px] font-normal text-muted">now {l.now}</span>}
    </>
  );
  return l.href ? (
    <Link href={l.href} prefetch={false} className="inline-flex min-h-11 items-center hover:text-navy hover:underline">
      {body}
    </Link>
  ) : (
    <span className="inline-flex min-h-11 items-center">{body}</span>
  );
}

function Leaders({ id, title, note, rows, identities }: { id: string; title: string; note: string; rows: HubLeader[]; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  return (
    <div className="mt-4">
      <h3 id={id} className="px-3 font-num text-[16px] font-bold uppercase tracking-wider text-navy">{title}</h3>
      <p className="px-3 text-[13px] leading-[1.35] text-muted">{note}</p>
      {rows.length ? (
        <ol aria-labelledby={id} className="mt-1 border-t border-line">
          {rows.map((l, i) => (
            <BoardRow key={l.team} place={i + 1} figure={oneDecimal(l.average)} unit="points per game">
              <TeamLine name={l.team} slug={l.slug} identities={identities} />
              <span className="block truncate text-[13px] text-muted">{l.games} games</span>
            </BoardRow>
          ))}
        </ol>
      ) : (
        <p className="border-y border-line px-3 py-3 text-[15px] text-muted">No team has {LEADER_MIN_GAMES} games yet.</p>
      )}
    </div>
  );
}

function OrgSection({ hub, o, identities }: { hub: SeasonHub; o: OrgHub; identities: Awaited<ReturnType<typeof loadIdentities>> }) {
  const { season, latest } = hub;
  const id = seasonId(o.org);
  const past = !latest;
  const league = o.org.slug === "uil" ? "" : `/${o.org.slug}`;
  const playoffs = latest ? `/playoffs${league}` : `/playoffs/season/${season}${league}`;
  return (
    <section aria-labelledby={id} className="mt-8 scroll-mt-4">
      <SectionBar id={id} title={o.org.label} aside={`${season} ${past ? "final" : "so far"}`} className="" />
      <h3 id={`${id}-top`} className="mt-4 px-3 font-num text-[16px] font-bold uppercase tracking-wider text-navy">
        {past ? "Final top five by rating" : "Top five by rating so far"}
      </h3>
      {o.top.length ? (
        <ol aria-labelledby={`${id}-top`} className="mt-1 border-t border-line">
          {o.top.map((t, i) => (
            <BoardRow key={t.slug} place={i + 1} figure={signed(t.rating)} unit="rating">
              <TeamLine name={t.name} slug={t.slug} identities={identities} />
              <span className="block truncate text-[13px] text-muted">{t.record}</span>
            </BoardRow>
          ))}
        </ol>
      ) : (
        <p className="border-y border-line px-3 py-3 text-[15px] text-muted">No team has enough games to be ranked yet.</p>
      )}
      <div className="px-3">
        <Link href={rankingsHref(season, hub.current, o.org)} className={LINK}>
          Full {o.org.label} rankings for {season}
        </Link>
      </div>

      <Leaders
        id={`${id}-scored`}
        title="Most points per game"
        note={`Points scored per game, teams with at least ${LEADER_MIN_GAMES} games. From scores not confirmed here, and forfeits are left out.`}
        rows={o.scored}
        identities={identities}
      />
      <Leaders
        id={`${id}-allowed`}
        title="Fewest points allowed per game"
        note={`Points allowed per game, teams with at least ${LEADER_MIN_GAMES} games. From scores not confirmed here, and forfeits are left out.`}
        rows={o.allowed}
        identities={identities}
      />

      <nav aria-label={`More ${o.org.label} ${season}`} className="mt-3 flex flex-wrap gap-x-5 px-3">
        <Link href={resultsHref(season, hub.current, o.org)} className={LINK}>
          {o.org.label} results
        </Link>
        {o.playoffs && (
          <Link href={playoffs} className={LINK}>
            {o.org.label} playoffs
          </Link>
        )}
        {o.lastReviewWeek !== undefined && (
          <Link href={reviewHref(season, o.lastReviewWeek, o.org)} className={LINK}>
            {o.org.label} week in review
          </Link>
        )}
        <Link href={orgHref("/records", o.org)} className={LINK}>
          {o.org.label} records
        </Link>
      </nav>
    </section>
  );
}

const Text = ({ children }: { children: ReactNode }) => <p className="px-3 text-[15px] leading-6 text-ink">{children}</p>;

export async function SeasonHubView({ hub }: Props) {
  const [alignments, identities, lineage] = await Promise.all([loadAlignments(), loadIdentities(), loadLineage()]);
  const link = finalLinker(alignments, identities, successorOf(lineage));
  const { season, latest } = hub;
  const orgs = hub.orgs.map((o) => o.org.label);
  const jump = [{ id: "finals", label: "UIL finals" }, ...hub.orgs.map((o) => ({ id: seasonId(o.org), label: o.org.label })), { id: "weeks", label: "Weeks" }];

  return (
    <>
      <div className="px-3 pt-5">
        <PageHeader
          id="season"
          eyebrow="Texas six-man football"
          title={`${season} season`}
          note={`${hub.games.toLocaleString("en-US")} games read from ${hub.programs} programs across ${orgs.join(", ")}${latest ? ", so far" : ""}. Scores are not confirmed here and may change.`}
        />
        {!latest && <p id="season-coverage" className="mt-1 max-w-prose text-[14px] leading-5 text-muted">{coverageLine(hub.coverage)}</p>}
        <nav aria-label="Jump to" className="mt-4 flex flex-wrap gap-2">
          {jump.map((j) => (
            <a key={j.id} href={`#${j.id}`} className={PILL}>
              {j.label}
            </a>
          ))}
        </nav>
      </div>

      <section aria-labelledby="finals" className="mt-8 scroll-mt-4">
        <SectionBar id="finals" title="UIL state finals" aside={String(season)} className="" />
        {hub.finals.length ? (
          <ul>
            {hub.finals.map((f) => {
              const champion = link(f.champion);
              const runnerUp = link(f.runnerUp);
              return (
                <li key={`${f.division}-${f.champion}`} className="border-b border-line px-3 py-1">
                  <p className="font-num text-[13px] font-bold uppercase tracking-widest text-red">{f.division ? `Division ${f.division}` : "Six-man"}</p>
                  <p className="flex items-center justify-between gap-3">
                    <span className="min-w-0 font-semibold text-ink">
                      <span className="sr-only">Champion: </span>
                      <FinalTeam name={f.champion} l={champion} />
                    </span>
                    <span className="shrink-0 text-right font-num text-[20px] font-bold tabular-nums text-navy">{f.championScore == null ? finalScore(f) : `${f.championScore}-${f.runnerUpScore}`}</span>
                  </p>
                  <p className="flex items-center text-[14px] text-muted">
                    <span className="pr-2">Runner-up</span>
                    <FinalTeam name={f.runnerUp} l={runnerUp} />
                  </p>
                  {f.championScore != null && f.scoreNote && <p className="pb-1 text-[13px] text-muted">{f.scoreNote}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-3 py-3">
            <p className="text-[15px] leading-6 text-ink">
              {latest ? `The ${season} UIL state finals are in December. Until then, follow the brackets round by round.` : `UIL has no state final on record for ${season}.`}
            </p>
            <Link href={latest ? "/playoffs" : "/championships"} className={LINK}>
              {latest ? "UIL playoffs" : "Every state championship"}
            </Link>
          </div>
        )}
        {hub.finals.length > 0 && (
          <div className="px-3">
            <Link href="/championships" className={LINK}>
              Every state championship
            </Link>
          </div>
        )}
      </section>

      {hub.orgs.map((o) => (
        <OrgSection key={o.org.slug} hub={hub} o={o} identities={identities} />
      ))}

      <section aria-labelledby="weeks" className="mt-8 scroll-mt-4">
        <SectionBar id="weeks" title="Week by week" aside={`${season}`} className="" />
        <h3 id="weeks-results" className="mt-4 px-3 font-num text-[16px] font-bold uppercase tracking-wider text-navy">Results by week</h3>
        <Text>Every game read that week, UIL first. Each organization has its own results pages.</Text>
        <ol aria-labelledby="weeks-results" className="mt-2 flex flex-wrap gap-2 px-3">
          {hub.weeks.map((w) => (
            <li key={w.number}>
              <Link href={weekHref(season, w.number)} prefetch={false} aria-label={`${season} week ${w.number} results, week of ${weekLabel(w.monday)}`} className={PILL}>
                {w.number}
              </Link>
            </li>
          ))}
        </ol>
        {hub.reviewWeeks.length > 0 && (
          <>
            <h3 id="weeks-review" className="mt-5 px-3 font-num text-[16px] font-bold uppercase tracking-wider text-navy">Week in review</h3>
            <Text>Rating movers, closest games and playoff advancement, one week at a time.</Text>
            <ol aria-labelledby="weeks-review" className="mt-2 flex flex-wrap gap-2 px-3">
              {hub.reviewWeeks.map((n) => (
                <li key={n}>
                  <Link href={reviewHref(season, n)} prefetch={false} aria-label={`${season} week ${n} in review`} className={PILL}>
                    {n}
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
        <nav aria-label={`More ${season} pages`} className="mt-4 flex flex-wrap gap-x-5 px-3">
          <Link href={resultsHref(season, hub.current)} className={LINK}>All {season} results</Link>
          <Link href={indexHref()} className={LINK}>Week in review, every season</Link>
          {(latest || hub.uilPlayoffs) && (
            <Link href={latest ? "/playoffs" : `/playoffs/season/${season}`} className={LINK}>{season} playoffs</Link>
          )}
          <Link href="/records" className={LINK}>Records</Link>
          <Link href="/seasons" className={LINK}>All seasons</Link>
        </nav>
      </section>
    </>
  );
}
