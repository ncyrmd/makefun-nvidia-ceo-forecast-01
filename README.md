# NVIDIA CEO forecast — `main.ts`

A forecaster for make.fun's `polymarket-nvidia-ceo-forecast-01`: for each of
Polymarket's "Next CEO of NVIDIA?" markets, it predicts the Yes price at every
minute of the 4 hours after a checkpoint, as five quantiles
(5%, 25%, 50%, 75%, 95%).

## How it works

The median is persistence — the price at the checkpoint. These prices are
close to martingales, and on the practice cases every drift or mean-reversion
term I tried made the score worse, so the forecast carries no drift at all.

The spread is where the work is. Two observations from the practice cases:

- **Quiet markets barely move.** The house baseline's fixed spread (0.0025 per
  root-minute) is far too wide for a market that has sat still for hours, and
  the pinball loss charges for that extra width at every quiet minute. So the
  base spread here is 0.0008, and it grows like `h^0.35` instead of `sqrt(h)`:
  the prices are sub-diffusive at short horizons, so the spread should open
  more slowly than a plain random walk's.
- **Volatile markets do jump.** A market that has just jumped keeps jumping
  for a while, so the spread widens with the market's own recent moves: an
  exponentially weighted mean of squared one-minute changes over the last two
  hours (half-life 40 minutes), capped at 0.01. A calm market never sees the
  widening; a jumpy one gets up to the cap.

Formally, for minute `h = 1..240` after the checkpoint:

```
q_tau(h) = clamp(x + z_tau * sigma * h^0.35, 0, 1)   (rounded to 6 decimals)
```

where `x` is the market's price at the checkpoint, `sigma` is
`max(0.0008, recent-volatility)`, and `z_tau` is the standard normal
quantile at each level.

## v2 — what changed from v1

v1 (spread `h^0.40`, half-life 15 min, 6-hour lookback, cap 0.005) scored
0.276437 on the practice cases. For v2 the four spread parameters were
tuned against the real post-checkpoint prices, fetched from Polymarket's
public price history and scored with the contest's exact pinball formula —
a local evaluator that reproduces the server's practice losses exactly
(v1: 0.276437, house baseline: 0.363589), so the tuning target is the real
one, not a proxy. The winning direction: a longer volatility half-life
(40 min, smoother and less fooled by single-minute noise), a shorter
lookback (120 min, the recent regime matters more), a higher cap (0.01,
so genuinely jumpy markets get the width they need), and a slower horizon
exponent (0.35, stronger sub-diffusion).

Structural alternatives were tried on the same data and rejected:
heavy-tail (Student-t) quantiles, logit-space forecasting, asymmetric
upper/lower widths, mean reversion toward the long-run median, pooled
empirical move quantiles, and per-horizon-band width multipliers — none
beat the tuned normal model on both halves of a tune/holdout split
(p00–p02 vs p03–p05). The final grades on twelve fresh checkpoints, so
the model stays in this simple, robust form.

## Practice result

Scored on the kit's six practice cases against the actual post-checkpoint
prices from Polymarket's public price history:

- **this entry (v2): 0.268205** mean pinball loss
- v1: 0.276437
- house baseline: 0.363589

That is about 26% below the house baseline and 3% below v1, better than
v1 on both halves of the tune/holdout split, with every case valid.

## Run it

Node 22, standard library only, no network, no randomness — two runs on the
same case write byte-identical output:

```
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads every `*.in` file in the input directory (the grader runs one case
at a time) and writes one `<id>.out` per case: `{"forecasts":[{"id", "q"}]}`,
240 rows of five quantiles per market. A run takes well under a second per
case on this machine, far inside the 8-second cap.
