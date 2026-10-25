# Design Engineering progress

## Implemented

- Repository inspection, authoritative interface review and isolated design branch.
- Plain HTML/CSS/JavaScript interface, responsive layouts and keyboard controls.
- JSON loading/validation, loading/error/partial-data states and safe text rendering.
- UTC hourly replay, play/pause, slider, previous/next and missing-hour handling.
- Article leaderboard with per-model cached/missed/unavailable states.
- Supplied hourly hit rates, model display-name mapping and accurate units.
- Foresight curve at 1/2/3/6 hours, missing-data gaps and visible values table.
- Spike selector, view trajectory, catch-lag lanes, source warnings and replay jump.
- Presentation navigation, test-period summary, optional horizon-1 oracle readout.
- Three-minute rehearsal script, provenance labels and visible limitations.

Browser checks cover the synthetic fixture plus incomplete and malformed
fixtures, replay timing, keyboard navigation, safe rendering and mobile overflow.
They do not validate the scientific results.

## Remaining gates to judging

1. Receive genuine backtest outputs and provenance confirmation.
2. Integrate them, validate units, scope, missing data and claims with owners.
3. Choose 2–3 verified event examples and finalise the pitch/deck if needed.
4. Review on the judging laptop, freeze, rehearse and publish approved changes.

The main frontend features are implemented. Remaining effort depends on the
arrival and quality of measured outputs; no reliable completion percentage or
time estimate can be made from synthetic data alone.

## Handoffs

| Owner | Needed | Interface | Frontend dependency |
|---|---|---|---|
| Computing | Genuine final replay, model identity, cache size, hourly rates, summary rates, horizon curve, oracle and catch lags; confirm test period and evaluation settings | `out/demo.json`, `out/results.csv` | Required to replace development values and make measured claims |
| EIE | Clean real data coverage, missing hours, data origin and 2–3 checked event contexts; confirm replay delivery if an API is used | `data/views.parquet`, `data/missing_hours.txt`, Computing's JSON; `api.py` endpoint if provided | Static JSON works independently; we do not compute results from parquet |
| Physics | Reviewed uncertainty estimates and catch-lag/statistical interpretation through Computing; any approved physics-model outputs | `out/results.csv` confidence interval columns and normal predictor/backtest handoff | Required for uncertainty/significance claims; current JSON has no CI fields |
| Whole team | Provenance approval, model naming, judging deadline, pitch claims and final code freeze | Team agreement and agreed output files | Required before calling results verified or freezing the demo |

The current local output is explicitly synthetic, has no oracle value or real
model display name, and `out/results.csv` has not been supplied. The frontend
does not infer that absent `_fake` means verified. Agree a provenance mechanism
with the team before changing the default unverified label.

## Git checkpoint

The foundation, replay and foresight curve were committed and pushed on
`design/demo-foundation`. Spike stories and the presentation pass are included
in the next approved publication checkpoint. No changes are made to
shared results or other teams' implementation by this frontend.
