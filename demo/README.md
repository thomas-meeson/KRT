# Ahead of the Spike frontend

Plain HTML, CSS and JavaScript. No packages or build step. From repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/demo/#start. Serve the root, not only demo/.

## Visitor journey

Start here explains the problem. Explore a day shows hourly article demand and
100,000 space performance. What we found presents 100,000 space aggregate
results. The optional storage page compares 10,000 with 100,000 spaces while
holding the approach and one hour planning time fixed.

Navigation pauses playback, supports browser history and moves keyboard focus.
The replay starts paused, advances every two seconds and stops at the end.
Manual navigation pauses. The slider supports arrows, Home and End. The article
list starts with six rows and can expand to the supplied 50. Technical details
are expandable. Reset returns to the start and closes all details.

## Explore data sources

Root demo.json still declares 10,000 spaces. Its recorded article demand is
independent of capacity. replay-data.js retains the supplied hour, total_views,
article names and view counts, then reads the already-scored hourly.csv rows
where cache_size is 100000 and horizon is 1. our_model maps to our_model_name.
Only exact matching UTC target hours and valid rates are displayed.

The CSV is the exact text already checked by provenance.js, avoiding a second
fetch that could mix result versions. Missing, invalid, duplicate or unconfirmed
hourly results stay unavailable. The frontend never calculates cache membership
or hit rates from demand, never reruns a predictor, and never substitutes 10k
rates for missing 100k rates.

Individual article readiness for 100k has not been supplied. Explore therefore
shows demand without the 10k cache tags, with an explicit explanation. If
Computing later supplies a native 100k demo.json, its matching per-article
statuses can be displayed after provenance is reviewed. The optional surge chart shows recorded article demand only. No 10k catch times or cache markers are presented as part of the main story.

## Results and provenance

run-metadata.json contains capacity profiles copied from results.csv and paired
findings copied from the published key_numbers reports. Main results and the
foresight curve use the 100k profile. The storage page uses both 10k and 100k.
No new experiment or statistical test runs in the frontend. Counts per 1,000
are rounded illustrations of supplied average hit rates.

The user confirmed Computing's final run. SHA-256 checks bind confirmation to
demo.json, results.csv, hourly.csv and both key_numbers reports. CRLF is
normalised to LF for Git portability. Missing or changed files revert to
unverified and suppress result profiles. Synthetic input always says synthetic.
Hashing requires localhost or HTTPS. Updating a run requires reviewing scope,
file digests and published statistics together; do not reuse old intervals.

The denominator is retained top 150,000 English Wikipedia pages per hour,
not all Wikipedia traffic. Test targets span 20 October 03:00 to 23 October
02:00 UTC; replay day is 22 October 2026. Horizon counts 1/2/3/6 are 72/71/70/67.
Oracle is perfect hindsight at horizon 1, not a deployable predictor.

## Editable interpretation

Event causes are optional, separate in event-context.json. Each exact page key
needs status checked, text and an HTTPS source_url to display. Text uses safe
DOM rendering. Missing or invalid editorial context does not block the demo.
Never infer a news cause from a title alone. Interpretation does not alter the
measurements or their confirmation.

See PITCH.md for rehearsal and PROGRESS.md for the remaining handoffs.


## How to explain the comparison

The public labels are Standard rule and Our model (XGBoost). Standard rule
corresponds to last_hour, a persistence baseline. Our model maps to the supplied
our_model_name. Actual article views are observations. Cache hit rates are
measured historical outcomes, not predicted view counts or forecast accuracy.

Start explains the two methods, then the sequence: past data, cache choice,
evaluation against later actual views. Explore shows the latest permitted
history hour and selected target hour. Both methods choose one hour ahead there.
The selected-hour gap is presentation arithmetic on the published rates.

Results distinguishes average hourly hit rates from one replay hour. Both
methods are evaluated at the same horizon. Six hours ahead means both commit
six hours before the target, not that the model detected a spike six hours early.
The 1h and 6h panels show both methods' actual outcomes as well as the published
paired differences. The standard rule is allowed to operate at either horizon.

Surge plots now show actual views only. The old 10k catch lanes and comparisons
are removed from the rendered interface to avoid mixing scopes. No per-article
forecast values or early-prediction evidence have been supplied. These remain
possible later handoffs rather than claims the UI currently makes.
