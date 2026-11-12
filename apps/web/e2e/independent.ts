import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The Independent organization (ADR 0012: one row in ORGS plus alignment rows) has one program for now, CenTex
// Chargers. It has no games in the robot-read files until the results robot next reads them (the robot, not a person,
// writes data/seed/maxpreps-*), and an organization with no game gets no rankings, results or records tab. These tests
// follow the data: they expect the tab once a CenTex game is in a season file, and no tab, no page before.
export const CENTEX = "CenTex Chargers Homeschool Sports Association";
export const COMMUNITY_CHRISTIAN = "Community Christian";

const SEED = path.join(__dirname, "../../../data/seed");
export const independentHasGames = readdirSync(SEED)
  .filter((d) => /^maxpreps-\d{4}$/.test(d))
  .some((d) => readFileSync(path.join(SEED, d, "games.csv"), "utf8").includes(CENTEX));

/** The organization tabs on Rankings, Results and Records. Standings never lists Independent (no districts). */
export const ORG_TABS = ["UIL", "TAPPS", "TAIAO", "TCAF", ...(independentHasGames ? ["Independent"] : [])];
export const STANDINGS_TABS = ["UIL", "TAPPS", "TAIAO", "TCAF"];
