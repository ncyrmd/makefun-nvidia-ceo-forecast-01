// Polymarket "Next CEO of NVIDIA?" forecaster (Node 22, standard library only).
//
// The idea: a market's Yes price is a step-like random walk, so the honest
// forecast is persistence — the median stays at the checkpoint price — with a
// spread that grows with the horizon. Two things the house baseline misses:
//
//   1. Quiet markets barely move. A fixed spread of 0.0025 per root-minute is
//      far too wide for a market that has sat still for hours, and the pinball
//      loss charges for every extra unit of width at every quiet minute. So
//      each market gets its own base spread of 0.0008, much narrower than the
//      house's, and the spread grows like h^0.40 rather than sqrt(h): the
//      prices here are sub-diffusive at short horizons (jumps partly revert),
//      so the spread should open up more slowly than a plain random walk's.
//
//   2. Volatile markets do jump. A market that has just jumped keeps jumping
//      for a while, so the spread is widened by what the market has actually
//      done lately: an exponentially weighted mean of squared one-minute
//      moves over the last six hours (half-life 15 minutes), capped at 0.005.
//      A calm market never sees the widening; a jumpy one gets up to the cap.
//      The cap is what keeps one wild minute from blowing the forecast out.
//
//   q_tau(h) = clamp(x + z_tau * sigma * h^0.40, 0, 1), rounded to 6 decimals
//
// where x is the market's price at the checkpoint, sigma is that market's
// spread above, and z_tau is the standard normal quantile at each level
// (0.05, 0.25, 0.5, 0.75, 0.95). No drift: the prices are close to
// martingales, and every trend or reversion term I tried on the practice
// cases made the score worse. No randomness anywhere, so two runs write
// byte-identical output.
//
// What the program must do (the contest's contract):
//   - read every <id>.in in the input directory (the grader runs one case at
//     a time, with only that case's file there), canonical JSON with
//     `markets` holding one Yes price per minute from `start` to `at`, so the
//     last price is the price at the checkpoint;
//   - write <id>.out to the output directory: {"forecasts":[{"id","q"}]},
//     every market exactly once, `q` exactly horizon_minutes rows, each row
//     five finite numbers in [0,1], non-decreasing, at the five quantile
//     levels in order. Anything else is an invalid case.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

/** A calm market's spread, in price units per h^0.40. */
const BASE_SIGMA = 0.0008;
/** How fast the spread opens with the horizon (sub-diffusive: below 0.5). */
const HORIZON_EXPONENT = 0.4;
/** The recent-volatility estimate's half-life, in minutes. */
const VOL_HALF_LIFE_MIN = 15;
/** How far back the volatility estimate looks, in minutes. */
const VOL_WINDOW_MIN = 360;
/** The widest the recent-volatility estimate may push the spread. */
const VOL_CAP = 0.005;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/**
 * A market's spread from its own recent moves: the root of the exponentially
 * weighted mean of squared one-minute price changes over the last
 * VOL_WINDOW_MIN minutes (half-life VOL_HALF_LIFE_MIN), floored at 0 and
 * capped at VOL_CAP. A market with too few moves to judge returns 0, and the
 * caller floors the spread at BASE_SIGMA anyway.
 */
function recentVolatility(prices: number[]): number {
  const n = prices.length;
  const span = Math.min(VOL_WINDOW_MIN, n - 1);
  if (span < 5) return 0;
  const decay = 0.5 ** (1 / VOL_HALF_LIFE_MIN);
  let weightedSquares = 0;
  let weightSum = 0;
  let weight = 1;
  for (let i = n - 1; i > n - 1 - span; i--) {
    const move = prices[i] as number - (prices[i - 1] as number);
    weightedSquares += weight * move * move;
    weightSum += weight;
    weight *= decay;
  }
  return Math.min(VOL_CAP, Math.sqrt(weightedSquares / weightSum));
}

/** The forecast of one market: horizon rows of the five quantiles around its last price. */
function forecast(market: CaseMarket, horizon: number): number[][] {
  const prices = market.prices;
  const x = prices.length === 0 ? 0.5 : (prices[prices.length - 1] as number);
  const sigma = Math.max(BASE_SIGMA, recentVolatility(prices));
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const width = sigma * Math.pow(h, HORIZON_EXPONENT);
    const row = Z.map((z) => price6(x + z * width));
    // The contract needs each row non-decreasing. Clamping and rounding are
    // both monotone, so the row already is — but enforce it explicitly, so a
    // floating-point edge can never hand the grader a decreasing row.
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
