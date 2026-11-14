import Link from "next/link";
import type { ReactNode } from "react";
import { activeOrgs } from "@/lib/active-orgs";
import { loadAlignments, programFor } from "@/lib/alignments";
import { recordsDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { orgHref, type Org } from "@/lib/orgs";
import { loadRecords } from "@/lib/records";
import { ratingSeasons } from "@/lib/ratings";
import { resultSeasons } from "@/lib/weeks";
import { TabNav } from "../tab-nav";
import { BoardRow, CrestSlot, PageHeader, SectionBar } from "../ui";

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Board({ id, title, note, rows, children }: { id: string; title: string; note?: string; rows: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <SectionBar id={id} title={title} className="" />
      {note && <p className="px-3 pt-2 text-[13px] leading-[1.35] text-muted">{note}</p>}
      {rows ? <ol>{children}</ol> : <p className="border-b border-line px-3 py-3 text-[15px] text-muted">None yet.</p>}
    </section>
  );
}

/** One team in a game, its score at the right. The team name is the tap target, so each team gets its own line. */
function Side({ team, score }: { team: ReactNode; score: number }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0 flex-1">{team}</span>
      <span className="font-num text-[18px] font-bold text-ink">{score}</span>
    </span>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <span className="block truncate text-[13px] text-muted">{children}</span>;

/** The game's own page, from a records row. */
const GameLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} prefetch={false} aria-label={`${label}, game page`} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2">
    Game page
  </Link>
);

/** One organization's records (ADR 0012): teams and games of the others never appear, except as the other side of a game. */
/** The meta description of an organization's records page. */
export async function describeRecords(org: Org) {
  const seasons = await resultSeasons(org);
  return recordsDescription({ org: org.label, first: seasons.at(-1), latest: seasons[0] });
}

export async function RecordsView({ org }: { org: Org }) {
  const [records, alignments, [latest], orgs, identities] = await Promise.all([loadRecords(org), loadAlignments(), ratingSeasons(), activeOrgs(org), loadIdentities()]);
  const team = (name: string) => {
    const slug = programFor(alignments, name, org.league)?.slug;
    const crest = <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />;
    return slug ? (
      <Link href={`/programs/${slug}`} className="flex min-h-11 items-center font-semibold leading-tight hover:text-navy hover:underline">
        {crest}
        {name}
      </Link>
    ) : (
      <b className="flex min-h-11 items-center leading-tight">
        {crest}
        {name}
      </b>
    );
  };
  const first = records.seasons.at(-1);

  return (
    <section aria-labelledby="records" className="max-w-3xl">
      <PageHeader
        id="records"
        eyebrow={`${org.label} · ${first} to ${records.seasons[0]} · ${records.games.toLocaleString("en-US")} games`}
        title="Records"
        note={`From every ${org.label} game on this site since ${first}. Scores may be corrected if a mistake is found.`}
      />
      <TabNav label="Organization" tabs={orgs.map((o) => ({ href: orgHref("/records", o), label: o.label }))} current={orgHref("/records", org)} />

      <Board id="points" title="Most points in a game" rows={records.mostPoints.length}>
        {records.mostPoints.map((g, i) => (
          <BoardRow key={`${g.date}-${g.team}`} place={i + 1} figure={g.points} unit="points">
            {team(g.team)}
            <Sub>{`${g.points}-${g.against} vs ${g.opponent} · ${day(g.date)}`}</Sub>
            <GameLink href={g.href} label={`${g.team} ${g.points}, ${g.opponent} ${g.against}`} />
          </BoardRow>
        ))}
      </Board>

      <Board id="combined" title="Most points by both teams" rows={records.mostCombined.length}>
        {records.mostCombined.map((g, i) => (
          <BoardRow key={`${g.date}-${g.team}`} place={i + 1} figure={g.points + g.against} unit="points combined">
            <Side team={team(g.team)} score={g.points} />
            <Side team={team(g.opponent)} score={g.against} />
            <Sub>{day(g.date)}</Sub>
            <GameLink href={g.href} label={`${g.team} ${g.points}, ${g.opponent} ${g.against}`} />
          </BoardRow>
        ))}
      </Board>

      <Board
        id="upsets"
        title="Biggest upsets"
        rows={records.upsets.length}
        note="The winner's win probability before the game, from both teams' ratings at the end of the week before, once each had played four games. Forfeits are left out."
      >
        {records.upsets.map((u, i) => (
          <BoardRow
            key={`${u.date}-${u.winner}`}
            place={i + 1}
            figure={u.chance < 0.01 ? "<1%" : `${Math.round(u.chance * 100)}%`}
            unit="win probability before the game"
          >
            <Side team={team(u.winner)} score={u.won} />
            <Side team={team(u.loser)} score={u.lost} />
            <Sub>{day(u.date)}</Sub>
            <GameLink href={u.href} label={`${u.winner} ${u.won}, ${u.loser} ${u.lost}`} />
          </BoardRow>
        ))}
      </Board>

      <Board id="streaks" title="Longest winning runs" rows={records.streaks.length} note="Wins in a row across seasons, playoffs included. A tie or a loss ends a run.">
        {records.streaks.map((s, i) => (
          <BoardRow key={s.team} place={i + 1} figure={s.wins} unit="wins in a row">
            {team(s.team)}
            <Sub>{s.current ? `${day(s.from)} to now, still going` : `${day(s.from)} to ${day(s.to)}`}</Sub>
          </BoardRow>
        ))}
      </Board>

      <Board id="unbeaten" title="Unbeaten seasons" rows={records.unbeaten.length} note={`No losses, at least 8 wins. ${latest} is still being played.`}>
        {records.unbeaten.map((u, i) => (
          <BoardRow key={`${u.season}-${u.team}`} place={i + 1} figure={u.tied ? `${u.won}-0-${u.tied}` : `${u.won}-0`} unit="record">
            {team(u.team)}
            <Sub>{u.season === latest ? `${u.season}, so far` : String(u.season)}</Sub>
          </BoardRow>
        ))}
      </Board>
    </section>
  );
}
