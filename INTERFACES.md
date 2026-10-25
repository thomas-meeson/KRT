# INTERFACES.md — Ahead of the Spike

The single source of truth for what each part hands to the next.
**If you need to change anything here, tell the team first, then update this file.**

```
EIE ──views.parquet──► Computing & Physics ──predictors──► backtest.py ──results.csv + demo.json──► Design Eng
```

| File / thing | Made by | Used by |
|---|---|---|
| `data/views.parquet` | EIE | everyone |
| predictor functions in `predictors/` | Computing, Physics | `backtest.py` |
| `backtest.py` | Computing | everyone |
| `out/results.csv` | `backtest.py` | slides |
| `out/demo.json` | `backtest.py` | Design Eng (demo) |

---

## 0. Conventions (everyone)

- **Time:** every timestamp is **UTC**, and an hour is labelled by its **start** (`14:00` = views from 14:00 to 14:59).
- **Page names:** exactly as in Wikipedia URLs, with underscores: `Taylor_Swift`, not `Taylor Swift`.
- **Wiki:** English Wikipedia only. Desktop (`en`) and mobile (`en.m`) are **added together**.
- **Excluded pages:** `Main_Page`, `-`, and anything starting with `Special:`, `File:`, `User:`, `Talk:`, `Wikipedia:`, `Portal:`, `Category:`, `Template:`, `Help:`.
- **Fake data first:** until real data exists, everyone uses fake files **in exactly these formats**.

---

## 1. `data/views.parquet` (EIE)

One row per page per hour.

| column | type | example | notes |
|---|---|---|---|
| `hour` | timestamp (UTC, naive) | `2026-10-20 14:00:00` | start of the hour |
| `page` | string | `Taylor_Swift` | conventions above |
| `views` | int | `18204` | desktop + mobile |

Rules:
- Drop rows with `views < 5` (keeps the file small; such pages never matter for the cache).
- Exactly one row per (`hour`, `page`). No duplicates.
- Sorted by `hour`, then `page`.
- Hours with no data at all (download failed) are simply absent. List them in `data/missing_hours.txt`, one per line.

Load it:
```python
import pandas as pd
df = pd.read_parquet("data/views.parquet")
```

Milestones: **2 days by ~02:30**, then keep growing overnight towards 7–10 days.

---

## 2. Predictors (Computing, Physics)

Every model, from the simplest baseline to the transformer, is **one function with this exact signature**, in its own file in `predictors/`:

```python
import pandas as pd

def predict(history: pd.DataFrame, now: pd.Timestamp, horizon: int = 1) -> pd.Series:
    """
    history : rows of views.parquet with hour <= now. NEVER use anything later.
    now     : the latest hour we have data for.
    horizon : predict views for hour now + horizon hours (1 = next hour).
    returns : pd.Series of predicted views (float, >= 0), indexed by page name.
              Only include pages you think could matter; any page not returned
              counts as a prediction of 0.
    """
```

**The golden rule:** a predictor may only read rows with `hour <= now`. `backtest.py` enforces this by only passing those rows, but don't load the parquet yourself inside a predictor.

Register each predictor in `predictors/__init__.py`:
```python
from .baselines import last_hour, last_24h_mean, same_hour_yesterday
PREDICTORS = {
    "last_hour": last_hour,                     # standard rule, ~ "least recently used"
    "last_24h_mean": last_24h_mean,             # ~ "least frequently used"
    "same_hour_yesterday": same_hour_yesterday,
    # "xgboost": xgb_predict,                   # Computing
    # "decay": decay_predict,                   # Physics
    # "transformer": transformer_predict,       # Computing
}
```

Models that need training: train **only on hours before the test period starts** (see section 3), save the model to `models/`, and have `predict` load it once (cache it in a module-level variable).

---

## 3. `backtest.py` (Computing)

### Settings (agreed, don't change without telling everyone)

| setting | value |
|---|---|
| test period | the **last 3 days** of `views.parquet`; everything before is training data |
| cache sizes N | **1,000 / 10,000 / 100,000** pages |
| horizons for the foresight curve | **1, 2, 3, 6** hours |
| main headline | hit rate at N = 10,000, horizon 1 |

### What it does, for every test hour `now`, predictor, cache size N, horizon h

1. `pred = predictor(history up to now, now, h)`
2. Cache = the top N pages by `pred`.
3. `actual` = real views at hour `now + h`.
4. **Hit rate** = (views of `actual` pages that are in the cache) ÷ (all views in `actual`).

### Spike definition (for "spike catch time")

A page **spikes** at hour `s` if:
- views at `s` ≥ 1,000, **and**
- views at `s` ≥ 10 × its median views over the previous 24 hours (missing hours count as 0).

**Catch lag** for a predictor = (first hour ≥ `s` at which the page is in that predictor's N = 10,000 cache) − `s`, in hours. 0 = cached exactly when the spike arrived. Spikes never caught within 24 hours get lag 24.

### Outputs

`out/results.csv`, one row per predictor × cache size × horizon:

| column | example |
|---|---|
| `predictor` | `xgboost` |
| `cache_size` | `10000` |
| `horizon` | `1` |
| `hit_rate` | `0.7831` |
| `hit_rate_ci_low` / `hit_rate_ci_high` | `0.7790` / `0.7869` (bootstrap over hours; Physics) |
| `median_catch_lag_h` | `1.0` |
| `n_hours` | `72` |

Run it:
```bash
python backtest.py --data data/views.parquet --out out/
```

---

## 4. `out/demo.json` (written by `backtest.py`, read by Design Eng)

One replay day (the last full day of the test period), comparing `last_hour` against the best model.

```json
{
  "day": "2026-10-22",
  "predictors": ["last_hour", "our_model"],
  "cache_size": 10000,
  "hours": [
    {
      "hour": "2026-10-22T14:00:00Z",
      "hit_rate": {"last_hour": 0.71, "our_model": 0.78},
      "total_views": 9876543,
      "top_pages": [
        {"page": "Taylor_Swift", "views": 18204,
         "cached": {"last_hour": true, "our_model": true}},
        {"page": "Some_New_Film", "views": 9310,
         "cached": {"last_hour": false, "our_model": true}}
      ]
    }
  ],
  "spikes": [
    {
      "page": "Some_New_Film",
      "spike_hour": "2026-10-22T13:00:00Z",
      "hours": ["2026-10-22T11:00:00Z", "2026-10-22T12:00:00Z", "2026-10-22T13:00:00Z",
                "2026-10-22T14:00:00Z", "2026-10-22T15:00:00Z"],
      "views": [120, 300, 9310, 8800, 6000],
      "catch_lag_h": {"last_hour": 1, "our_model": 0}
    }
  ],
  "summary": {
    "hit_rate": {"last_hour": 0.70, "our_model": 0.77},
    "foresight_curve": {
      "horizons": [1, 2, 3, 6],
      "hit_rate": {"last_hour": [0.70, 0.66, 0.63, 0.57], "our_model": [0.77, 0.74, 0.71, 0.66]}
    }
  }
}
```

Rules:
- `top_pages`: the **50** most-viewed pages that hour, sorted by views, descending.
- `spikes`: up to **10** of the biggest spikes in the replay day, each with views from 2 hours before to 6 hours after the spike.
- Timestamps in ISO format with `Z`.
- Hit rates are fractions (0–1), not percentages.

**Design Eng:** copy this example into `out/demo.json`, invent more hours, and build the demo against it tonight. The real file will have exactly this shape.

---

## 5. Folder layout

```
wiki_cache/
  INTERFACES.md        <- this file
  data/
    views.parquet
    missing_hours.txt
  download.py          <- EIE
  make_fake_data.py    <- Computing (fake views.parquet + demo.json)
  predictors/
    __init__.py        <- PREDICTORS registry
    baselines.py       <- Computing
    xgb.py             <- Computing
    decay.py           <- Physics
    transformer.py     <- Computing
  models/              <- saved trained models
  backtest.py          <- Computing
  api.py               <- EIE (serves out/demo.json to the demo)
  demo/                <- Design Eng
  out/
    results.csv
    demo.json
```

## 6. Owners (who to ask)

| Area | Owner |
|---|---|
| `views.parquet`, download, API | EIE |
| predictor format, baselines, XGBoost, transformer, `backtest.py` | Computing |
| decay model, cache-with-switching-cost, confidence intervals | Physics |
| `demo.json` usage, demo, slides | Design Eng |
