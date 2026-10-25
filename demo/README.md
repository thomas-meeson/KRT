# Ahead of the Spike — frontend foundation

Plain HTML, CSS and JavaScript; no packages or build step.

From the repository root, run:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/demo/ in your browser. Serve the repository root,
not only this directory: the page fetches `../out/demo.json`. Opening the HTML
directly as a file does not reliably allow fetch.

The replay starts paused at the earliest valid hour of the supplied replay day.
Play advances one available record every two seconds and stops at the final
record. Replay day restarts from the beginning. Previous/Next and the native
range slider pause playback and update the timestamp, hit rates and leaderboard
together. Focus the slider and use arrow keys, Home or End to navigate.

The timeline represents available records, not continuous elapsed time. Missing
hours are explicitly noted and skipped without inventing intermediate data.
Single-hour datasets disable navigation. Playback pauses when the page becomes
hidden and does not resume automatically. Reduced-motion users get the same
instant updates, with no decorative transitions or autoplay.

The foresight chart reads `summary.foresight_curve` once per dataset load and
does not change with the replay hour. Horizons 1, 2, 3 and 6 use proportional
horizontal spacing and a fixed 0–100% vertical scale. Exact values are available
in the visible table. Line styles and point shapes supplement colour.
Missing/invalid values break lines; ambiguous array lengths invalidate the
affected series. Duplicate or unsupported horizon definitions are rejected for
the chart without blocking the replay. No results are recomputed.

The repository's updated `INTERFACES.md` is the contract used for this increment.
`our_model`
remains a lookup key; `our_model_name`, when non-empty, is used for display in
metrics, the leaderboard and chart. Older fixtures lacking it retain their key
as a label. Inspection of the updated `backtest.py` confirms that
`summary.oracle_hit_rate` is the horizon-1 ceiling at the replay cache size;
it is not plotted as a multi-horizon curve.
The presentation summary displays this scalar alongside the supplied
`summary.hit_rate` values and labels all of them as test-period, horizon-1
results, distinct from the selected hourly replay. Missing/invalid oracle
values stay Unavailable. The oracle uses future observations and is not a
deployable predictor.

The five story links pause playback and navigate with keyboard focus to the
comparison, replay, spike story, foresight and limitations. Reset walkthrough
pauses playback and returns to the first available replay hour and summary.
See `PITCH.md` for rehearsal and `PROGRESS.md` for remaining handoffs.

The spike selector uses supplied records only. View counts and reported catch
lags appear in a trajectory, separate catch-time lanes, numerical readouts and
an expandable values table. The event button pauses and jumps the main replay
to the exact onset if that hour is available, then moves focus to the timeline.
Selecting an event itself does not change replay state.

Malformed records (invalid timestamps, duplicate hours, missing onset or
misaligned views arrays) are omitted with a count. Invalid observations and zero
values break the trajectory: the contract uses zero for missing/out-of-range
data, so exact zero traffic cannot be established. Nonconsecutive timestamps
also break lines. The values table retains zero as a supplied, uncertain count.
Lag 0 means at arrival; lag 24 is capped, never an exact catch marker or an input
to an earlier-response claim. Invalid lags show Unavailable. Exact catch markers
outside the trajectory window are described without extending the view data.
Records below the 1,000-view onset minimum are flagged; relative-response claims
are withheld. The 24-hour median criterion cannot be checked from the short
window, so event classification remains supplied, not frontend-verified.

Model selection is a later increment.

`_fake: true` is recognised as synthetic. Its absence or false value is **not**
proof of real data: the page defaults to DEVELOPMENT DATA / UNVERIFIED. A verified
provenance handoff must be agreed before publishing measured-result claims.
No JSON schema extensions are required by this frontend.

The current synthetic generator is only a UI fixture: simulated model caches
can differ in size, the reported capacity does not describe its simulation,
and some supplied spikes do not meet the agreed definition. Do not use its
values to establish performance or event claims.

Validation covers fields used in this increment. Invalid required replay
structure produces an error; invalid optional metrics display Unavailable.
Malformed article rows are omitted with an explicit warning. Unknown cache
decisions are not treated as misses. UTC timestamps must be exact hour starts;
duplicate hours are rejected. Article names are inserted with textContent.
The leaderboard does not recalculate hit rates or claim to list cache contents.

Checks for this increment: source syntax; supplied-data rendering; renamed model
identifiers; missing, invalid and empty data; HTML-like article names; mobile
overflow; keyboard focus and readable provenance. No teammate-owned data is
modified by the frontend.
