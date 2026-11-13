// The game night: which Central date "tonight's games" means, and how a night's games are grouped. No imports, so the
// node tests run it as it is. Twin of `gameNight` in tools/league-watch/maxpreps.mjs (the reader that fills tonight's
// scores): change both together, or the page and the robot disagree about which night it is.

/** The date in Texas ("YYYY-MM-DD"), whatever zone the build or the runner clock is in. */
const centralDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);

/** The game night's own date: until 6 AM Central it is still the night before, so a game that ends after midnight stays on its night. */
export const gameNight = (now = new Date()) => centralDate(new Date(now.getTime() - 6 * 3600_000));

/** True for a real calendar date written "YYYY-MM-DD" (never "2026-02-30"). */
export function isNight(text: string | undefined): text is string {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** "Friday, November 13" for a night. */
export const nightTitle = (night: string) =>
  new Date(`${night}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** The games dated `night`. A game with no date is on no night. */
export const onNight = <T extends { date?: string }>(games: T[], night: string): T[] => games.filter((g) => g.date === night);

/** One game of a night with the organization (its slug) and round it sits under. A round of "" is a regular-season game. */
export type Slot<T> = { org: string; round: string; sort: string; game: T };
export type NightGroup<T> = { org: string; rounds: { round: string; games: T[] }[] };

/**
 * A night's games by organization, in `orgOrder`, then by round, in `roundOrder` (an unknown round after the known ones,
 * a regular-season game last), then by `sort`. An organization never shares a group with another (ADR 0012); a game that
 * two organizations both have a team in is given one slot for each. An organization with no game has no group.
 */
export function groupNight<T>(slots: Slot<T>[], orgOrder: string[], roundOrder: string[]): NightGroup<T>[] {
  const rank = (round: string) => (round === "" ? 1e6 : roundOrder.indexOf(round) < 0 ? 1e5 : roundOrder.indexOf(round));
  return orgOrder.flatMap((org) => {
    const mine = slots.filter((s) => s.org === org);
    const rounds = [...new Set(mine.map((s) => s.round))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return mine.length
      ? [{ org, rounds: rounds.map((round) => ({ round, games: mine.filter((s) => s.round === round).sort((a, b) => a.sort.localeCompare(b.sort)).map((s) => s.game) })) }]
      : [];
  });
}
