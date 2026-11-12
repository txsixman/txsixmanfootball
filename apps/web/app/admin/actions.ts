"use server";

import { revalidatePath } from "next/cache";
import { NotAdmin } from "@/lib/auth/admin";
import { AuditFailed, writeAudit } from "@/lib/admin/audit";
import { runEdit, type EditDeps, type EditResult } from "@/lib/admin/edit";
import { appendGameCorrection, appendProgramMerge, GAME_HEADER, idSeason, PROGRAM_HEADER } from "@/lib/admin/files";
import { fieldErrors, formFields, GameFixInput, MergeInput } from "@/lib/admin/inputs";
import type { FormState } from "@/lib/admin/results";
import { adminContext, loadLiveCorrections, loadLiveGames, loadLiveSchools, SEARCH_SEASONS } from "@/lib/admin/service";
import { correctionKey } from "@/lib/corrections";
import { slugify } from "@/lib/slug";

// The console's two jobs. Every action: (1) checks the admin on the server (a server action is a public POST endpoint, so
// the page's check is not enough), (2) validates every input, (3) reads the live files from main and checks the ids
// exist, (4) writes the audit row, then (5) commits the correction to data/corrections/ on main. The site shows it after
// its next build (a push to main deploys). Nothing here names a winner or marks a score confirmed (ADR 0011).

const today = () => new Date().toISOString().slice(0, 10);
const NOT_ALLOWED: FormState = { error: "Not allowed." };

/** The edit's outcome as form text. The audit row failing is its own message: the sign-in may have lapsed, or the admin row is missing. */
async function attempt(edit: Promise<EditResult>, done: string): Promise<FormState> {
  try {
    return outcome(await edit, done);
  } catch (e) {
    if (e instanceof AuditFailed) return { error: "The audit row could not be written, so nothing was saved. Sign in again, and check that your id is in admin_user." };
    throw e;
  }
}

function outcome(result: EditResult, done: string): FormState {
  if (result.ok) return { ok: `${done} It shows on the site after the next build.` };
  if (result.reason === "conflict") return { error: "The file kept changing under us. Nothing was saved; try again." };
  if (result.reason === "invalid") return { error: "That edit would leave a data file the site cannot read. Nothing was saved." };
  return { error: "GitHub refused the save. Nothing was changed (the audit log records the attempt)." };
}

const deps = (ctx: Awaited<ReturnType<typeof adminContext>>): EditDeps => ({
  audit: (entry) => writeAudit(ctx.supabase, entry),
  commit: (kind, edit, message) => ctx.github.editCorrectionFile(kind, kind === "games" ? GAME_HEADER : PROGRAM_HEADER, edit, message),
});

export async function fixGame(_previous: FormState, data: FormData): Promise<FormState> {
  let ctx;
  try {
    ctx = await adminContext();
  } catch (e) {
    return e instanceof NotAdmin ? NOT_ALLOWED : { error: "Admin is not configured." };
  }
  const parsed = GameFixInput.safeParse(formFields(data, ["action", "id", "home_score", "away_score", "winner", "source_url", "reason"]));
  if (!parsed.success) return { error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  const input = parsed.data;

  const season = idSeason(input.id);
  if (!season || !SEARCH_SEASONS.includes(season)) return { error: "No such game." };
  const live = await loadLiveCorrections(ctx.github);
  const game = (await loadLiveGames(ctx.github, season, live.merges)).find((g) => g.id === input.id);
  if (!game) return { error: "No such game." };

  const [homeScore, awayScore] =
    input.action === "score" ? [String(input.home_score), String(input.away_score)] : input.action === "forfeit" ? (input.winner === "home" ? ["1", "0"] : ["0", "1"]) : ["", ""];
  const row = {
    game_date: game.date,
    home: game.home,
    away: game.away,
    action: input.action,
    home_score: homeScore,
    away_score: awayScore,
    source_url: input.source_url,
    reason: input.reason,
    corrected_on: today(),
  };
  const earlier = live.games.get(correctionKey(game.date, game.home, game.away));
  const state = await attempt(
    runEdit(deps(ctx), {
      kind: "games",
      entry: {
        entity: "game_correction",
        key: game.id,
        before: { game: `${game.away} at ${game.home}, ${game.date}`, home_score: game.homeScore, away_score: game.awayScore, earlier_correction: earlier ?? null },
        after: { action: input.action, home_score: homeScore, away_score: awayScore, source_url: input.source_url },
        reason: input.reason,
      },
      edit: (text) => appendGameCorrection(text, row),
      message: `Admin: ${input.action} ${game.date} ${game.away} at ${game.home}`.slice(0, 120),
    }),
    input.action === "void" ? "Game voided." : input.action === "forfeit" ? "Forfeit saved." : "Score saved.",
  );
  revalidatePath("/admin", "layout");
  return state;
}

export async function mergePrograms(_previous: FormState, data: FormData): Promise<FormState> {
  let ctx;
  try {
    ctx = await adminContext();
  } catch (e) {
    return e instanceof NotAdmin ? NOT_ALLOWED : { error: "Admin is not configured." };
  }
  const parsed = MergeInput.safeParse(formFields(data, ["name", "same_as", "source_url", "reason"]));
  if (!parsed.success) return { error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  const input = parsed.data;

  const [live, schools] = await Promise.all([loadLiveCorrections(ctx.github), loadLiveSchools(ctx.github)]);
  // B must be a listed program (exact spelling taken from the alignment); A must be a spelling no alignment lists.
  const target = schools.names.find((n) => slugify(n) === slugify(input.same_as));
  if (!target) return { error: "Check the highlighted fields.", fields: { same_as: "Not a listed program" } };
  if (schools.slugs.has(slugify(input.name))) return { error: "Check the highlighted fields.", fields: { name: "That is a listed program; only a spelling the results use can be merged" } };
  // ...and one the game files really use, in any season the console searches (the raw names, before any merge).
  const seen = (await Promise.all(SEARCH_SEASONS.map((s) => loadLiveGames(ctx.github, s, new Map())))).flat();
  if (!seen.some((g) => g.home === input.name || g.away === input.name)) return { error: "Check the highlighted fields.", fields: { name: "No game uses that exact name" } };

  const row = { name: input.name, same_as: target, source_url: input.source_url, reason: input.reason, corrected_on: today() };
  const state = await attempt(
    runEdit(deps(ctx), {
      kind: "programs",
      entry: {
        entity: "program_merge",
        key: input.name,
        before: { name: input.name, was: live.merges.get(input.name) ?? null },
        after: { name: input.name, same_as: target, source_url: input.source_url },
        reason: input.reason,
      },
      edit: (text) => appendProgramMerge(text, row, live.gamesText),
      message: `Admin: merge ${input.name} into ${target}`.slice(0, 120),
    }),
    `${input.name} is now ${target}.`,
  );
  revalidatePath("/admin", "layout");
  return state;
}
