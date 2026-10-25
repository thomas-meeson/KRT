# Design Engineering progress

## Complete

The guided frontend, chronological navigation, accessible replay controls,
article demand list, 100k hourly scores, 100k summary and foresight, optional
10k versus 100k storage comparison, labelled spike examples, sourced findings,
provenance checks and a three minute walkthrough are implemented.

Explore now uses 100,000 space hourly results from hourly.csv. Demand comes
from demo.json because popularity does not depend on cache size. All 24 hours
were checked against both methods' published CSV values. No 10k membership tags
are displayed as 100k choices. Failed or missing hourly results are unavailable,
with no substitute scores.

Main summary: 85.22% recent popularity, 86.61% forecast, 89.82% perfect hindsight.
Published paired improvements are 1.38 percentage points at one hour and 3.08
at six. The storage comparison fixes the method and time while changing capacity.
It does not make hardware price or optimal storage claims.

## Remaining optional handoff

Computing can supply a native 100k demo.json with top_pages cached statuses and
matching spike catch times. That restores individual readiness labels at 100k.
It does not block the current hourly percentages, demand list or main results.
The existing optional spike examples retain their explicit 10k catch-time scope.

Event explanations can be sourced and added later without changing counts.
Final presentation length, slide needs, hardware review and freeze remain team
choices. Three minutes is the working pitch length.

## Preservation and Git

Local parquet and 123 hourly files were preserved before merging team changes.
Verified backup: sibling workspace directory krt-data-backup-20261025. These raw
files are not used to calculate frontend results. Shared model code and outputs
are unchanged by this work.

Latest team changes through 6fc70ec are merged locally. The current integration,
guided design and capacity changes are not committed or pushed. The last pushed
frontend checkpoint is 9d97fe8 on design/demo-foundation.

## Clarity review implemented

Method identities, past-only decision sequence, actual demand and measured
cache outcomes are explicitly separated. Explore shows the target/history
hours; results labels averages and the equal-horizon comparisons. All 24 hourly
rates remain sourced from the existing 100k CSV. Six-hour headline is better
cache decisions when planning ahead, not proven early spike prediction.
The mixed 10k catch markers are no longer rendered; observed surge trajectories
are retained without predicted curves or per-article response claims.
