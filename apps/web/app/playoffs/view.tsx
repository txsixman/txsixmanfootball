import Link from "next/link";
import { loadAlignments, programFor } from "@/lib/alignments";
import { LEAGUES, loadBrackets, playoffLeagues, playoffSeasons, type BracketRow } from "@/lib/brackets";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { projectionParts, projectionText } from "@/lib/projection";
import { TabNav } from "../tab-nav";
import { CrestSlot, PageHeader, SectionBar } from "../ui";
import { ChanceList } from "./chance-list";

export type League = (typeof LEAGUES)[number];
/** The latest season lives at /playoffs; past seasons at /playoffs/season/<year> (UIL) and .../<league>. */
const leagueHref = (league: League, season?: number) => {
  const slug = league === "UIL" ? "" : `/${league.toLowerCase()}`;
  return season === undefined ? `/playoffs${slug}` : `/playoffs/season/${season}${slug}`;
};

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** One league's playoff brackets for a season (the latest by default), round by round. Robot-read scores are unconfirmed, so no row names a winner (ADR 0004). */
export async function PlayoffsView({ league, season }: { league: League; season?: number }) {
  const seasons = await playoffSeasons();
  const year = season ?? seasons[0];
  const past = year !== seasons[0];
  const [all, alignments, identities, leagues, perSeason] = await Promise.all([
    loadBrackets(year),
    loadAlignments(),
    loadIdentities(),
    playoffLeagues(year),
    Promise.all(seasons.map(playoffLeagues)),
  ]);
  const brackets = all.filter((b) => b.league === league);
  // A season tab keeps the league you are on when that season has it, else opens on UIL.
  const seasonTabs = seasons.map((s, i) => ({
    href: leagueHref(perSeason[i].includes(league) ? league : "UIL", s === seasons[0] ? undefined : s),
    label: String(s),
  }));

  const team = (name: string, score: number | undefined) => {
    const slug = programFor(alignments, name, league)?.slug;
    // The crest and name are one tap target (the program page); a team missing from today's alignments is plain text.
    const label = (
      <>
        <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />
        <span className="line-clamp-2 min-w-0 leading-tight">{name}</span>
      </>
    );
    return (
      <span className="flex min-h-11 items-center">
        {slug ? (
          <Link href={`/programs/${slug}`} className="flex min-h-11 min-w-0 flex-1 items-center hover:text-navy hover:underline">
            {label}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center">{label}</span>
        )}
        <span className="w-10 shrink-0 text-right font-num text-[22px] font-bold tabular-nums">{score ?? ""}</span>
      </span>
    );
  };
  const note = (g: BracketRow) =>
    g.forfeit ? "Forfeit" : g.projection ? `Projected: ${projectionText(g.projection)}` : g.homeScore == null ? "Not yet played" : "";

  return (
    <section aria-labelledby="playoffs">
      <PageHeader id="playoffs" eyebrow={`${year} season · ${brackets.length} ${brackets.length === 1 ? "bracket" : "brackets"}`} title="Playoffs" />
      {seasons.length > 1 && <TabNav label="Season" tabs={seasonTabs} current={seasonTabs[seasons.indexOf(year)].href} />}
      <TabNav label="League" tabs={leagues.map((l) => ({ href: leagueHref(l, past ? year : undefined), label: l }))} current={leagueHref(league, past ? year : undefined)} />
      {brackets.map((b) => {
        const id = `bracket-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const roundId = (round: string) => `${id}-${round}`;
        return (
          <section key={b.name} aria-labelledby={id} className="mt-8">
            <SectionBar id={id} title={b.name} aside={`Latest: ${b.rounds.at(-1)!.label}`} className="" />
            {b.rounds.length > 1 && (
              // Rounds run earliest first, so the latest is far down a phone: one tap gets to any of them.
              <nav aria-label={`${b.name} rounds`} className="flex flex-wrap border-b border-line px-1">
                {b.rounds.map((r) => (
                  <a key={r.round} href={`#${roundId(r.round)}`} className="inline-flex min-h-11 items-center px-2 font-num text-[16px] font-bold uppercase tracking-wide text-navy underline-offset-4 hover:underline">
                    {r.label}
                  </a>
                ))}
              </nav>
            )}
            {(b.chances || b.regionChances?.length) && (
              <div className="grid gap-x-8 gap-y-5 border-b border-line px-3 py-4 sm:grid-cols-2">
                {b.chances && <ChanceList id={`${id}-chances`} title="State title chances" chances={b.chances} identities={identities} />}
                {b.regionChances?.map((r) => (
                  <ChanceList key={r.region} id={`${id}-region-${r.region}`} title={`Region ${r.region} · region title chances`} chances={r.chances} identities={identities} />
                ))}
              </div>
            )}
            {b.rounds.map((r) => (
              <section key={r.round} id={roundId(r.round)} aria-label={`${b.name}, ${r.label}`} className="mt-5 scroll-mt-4">
                <h3 className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
                  {r.label} <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">· {r.games.length} {r.games.length === 1 ? "game" : "games"}</span>
                </h3>
                <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                  {r.games.map((g) => {
                    const n = note(g);
                    const proj = g.projection && !g.forfeit ? projectionParts(g.projection) : undefined;
                    return (
                      <li key={`${g.date}-${g.home}-${g.away}`} className="min-w-0 border-b border-line px-3 py-1 text-[16px] text-ink">
                        {team(g.away, g.forfeit ? undefined : g.awayScore)}
                        {team(g.home, g.forfeit ? undefined : g.homeScore)}
                        <p className="pb-1.5 pl-12 text-[14px] leading-5 text-muted">
                          {day(g.date)}
                          {g.neutral ? "" : ` · at ${g.home}`}
                          {/* The projection is the line a fan wants, so it gets a line of its own. */}
                          {proj ? (
                            <span className="block font-semibold text-navy">
                              <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
                            </span>
                          ) : (
                            n && ` · ${n}`
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </section>
        );
      })}
      <p className="mt-6 text-[13px] text-muted">
        Away team first. Scores are not confirmed here and may change; a team&rsquo;s next game shows who went on.
        {!past && " Projections and region and state title chances use the current ratings, on a neutral field unless the game is at a home site. A region\u2019s chances show once its two area games or its regional game are set."}
      </p>
    </section>
  );
}
