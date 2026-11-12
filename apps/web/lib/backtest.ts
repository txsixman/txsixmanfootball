import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { BacktestFile, parseJson } from "./data-schemas";
import { memo } from "./memo";

// data/ratings/backtest.json, written by services/ratings/run.py --backtest (plan v1.2 section 4): every week of a
// season predicted from only the games before it, by the ratings and by two simpler methods. `model` is the ratings as the
// site shows them (each season starts from last season's rating and the league's level); `model_no_prior` is the same
// model without last season, for comparison.

export type Backtest = z.output<typeof BacktestFile>;

/** Read once per process: never mutate it. */
export const loadBacktest = memo<void, Backtest>(async () =>
  parseJson("data/ratings/backtest.json", await readFile(path.join(process.cwd(), "../../data/ratings/backtest.json"), "utf8"), BacktestFile),
);
