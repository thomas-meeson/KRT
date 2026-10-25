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

The supplied updated `INTERFACES (1).md` is the contract used for this increment.
The repository's root interface document has not been replaced. `our_model`
remains a lookup key; `our_model_name`, when non-empty, is used for display in
metrics, the leaderboard and chart. Older fixtures lacking it retain their key
as a label. The updated contract also introduces `summary.oracle_hit_rate`, but
does not define its type or horizon scope; it is not plotted as a multi-horizon
ceiling. Computing needs to clarify this before that feature is added.
Spike zeros may stand for missing or out-of-range hours under the new contract;
future spike storytelling must not treat these as verified zero traffic.

Model selection and spike charts are later increments.

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
