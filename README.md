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
  base spread here is 0.0008, and it grows like `h^0.40` instead of `sqrt(h)`:
  the prices are sub-diffusive at short horizons, so the spread should open
  more slowly than a plain random walk's.
- **Volatile markets do jump.** A market that has just jumped keeps jumping
  for a while, so the spread widens with the market's own recent moves: an
  exponentially weighted mean of squared one-minute changes over the last six
  hours (half-life 15 minutes), capped at 0.005. A calm market never sees the
  widening; a jumpy one gets up to the cap.

Formally, for minute `h = 1..240` after the checkpoint:

```
q_tau(h) = clamp(x + z_tau * sigma * h^0.40, 0, 1)   (rounded to 6 decimals)
```

where `x` is the market's price at the checkpoint, `sigma` is
`max(0.0008, recent-volatility)`, and `z_tau` is the standard normal
quantile at each level.

## Practice result

Scored locally on the kit's six practice cases against the actual prices
(the answers rebuilt from the next case's inputs for p00–p04, and from
Polymarket's public price history for p05):

- **this entry: 0.276437** mean pinball loss
- house baseline: 0.363589

That is about 24% below the house baseline, with every case valid.

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
