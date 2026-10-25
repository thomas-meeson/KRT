"""Score every predictor in predictors/PREDICTORS exactly as INTERFACES.md section 3 describes.

For every test hour `now`, predictor, horizon h and cache size N:
    1. pred = predictor(history up to now, now, h)       (the predictor never sees later rows)
    2. cache = top N pages by pred
    3. hit rate = views at hour now+h that land on cached pages / all views at now+h

Also runs the "oracle" (cheats: uses the real future) as the ceiling, detects spikes, measures
how many hours late each predictor caught them, bootstraps confidence intervals over hours,
and writes:
    out/results.csv   one row per predictor x cache size x horizon
    out/demo.json     replay of the last full test day for the demo (INTERFACES.md section 4)

Speed: by default each predictor gets only the last --history-days days of history (still all
rows with hour <= now inside that window). Use --history-days 0 to pass everything.

Usage:
    python backtest.py                                           # real cache sizes
    python backtest.py --sizes 100 300 1000 --demo-size 300      # fake data (only 3,000 pages)
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from predictors import PREDICTORS

HOUR = pd.Timedelta(hours=1)
SPIKE_MIN_VIEWS = 1000
SPIKE_FACTOR = 10
MAX_LAG = 24


def iso(t) -> str:
    return pd.Timestamp(t).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_spikes(df: pd.DataFrame, first: pd.Timestamp, last: pd.Timestamp) -> pd.DataFrame:
    """Spike onsets between first and last (INTERFACES.md: views >= 1000 and >= 10x the median of the
    previous 24 hours, missing hours counting as 0). Only the first hour of each spike counts."""
    cands = df.loc[(df["hour"] >= first) & (df["hour"] <= last) & (df["views"] >= SPIKE_MIN_VIEWS), "page"].unique()
    if len(cands) == 0:
        return pd.DataFrame(columns=["page", "spike_hour", "views"])
    full = pd.date_range(first - 24 * HOUR, last, freq="h")
    sub = df[df["page"].isin(cands) & (df["hour"] >= full[0]) & (df["hour"] <= last)]
    M = sub.pivot_table(index="hour", columns="page", values="views", aggfunc="sum").reindex(full).fillna(0).to_numpy()
    pages = sub.pivot_table(index="hour", columns="page", values="views", aggfunc="sum").columns.to_numpy()
    rows, prev = [], np.zeros(M.shape[1], bool)
    for i in range(24, len(full)):
        med = np.median(M[i - 24:i], axis=0)
        spike = (M[i] >= SPIKE_MIN_VIEWS) & (M[i] >= SPIKE_FACTOR * med)
        for j in np.nonzero(spike & ~prev)[0]:
            rows.append({"page": pages[j], "spike_hour": full[i], "views": int(M[i, j])})
        prev = spike
    return pd.DataFrame(rows)


def bootstrap_ci(x: np.ndarray, n: int = 1000, seed: int = 0) -> tuple[float, float]:
    """95% interval for the mean hit rate, resampling hours with replacement."""
    if len(x) < 2:
        return float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    means = rng.choice(x, size=(n, len(x)), replace=True).mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def run(df: pd.DataFrame, predictors: dict, sizes: list[int], horizons: list[int], test_days: float,
        history_days: float, demo_size: int) -> tuple[pd.DataFrame, dict]:
    df = df.sort_values("hour", kind="stable").reset_index(drop=True)
    hour_arr = df["hour"].to_numpy()
    hours = pd.DatetimeIndex(np.unique(hour_arr))
    last = hours[-1]
    test_start = last - pd.Timedelta(days=test_days) + HOUR
    test_nows = [h for h in hours if h >= test_start - HOUR and h < last]
    by_hour = {h: g.set_index("page")["views"] for h, g in df[df["hour"] >= test_start - 25 * HOUR].groupby("hour")}
    sizes = sorted(sizes)
    max_n = max(sizes + [demo_size])
    all_preds = {**predictors, "oracle": None}
    print(f"test period {test_start} .. {last} ({len([h for h in hours if h >= test_start])} hours with data), "
          f"{len(all_preds)} predictors incl. oracle, sizes {sizes}, horizons {horizons}")

    # Replay day = last day in the test period with (nearly) all 24 hours.
    test_hours = [h for h in hours if h >= test_start]
    per_day = pd.Series(pd.DatetimeIndex(test_hours).normalize()).value_counts()
    replay_day = per_day[per_day >= 23].index.max() if (per_day >= 23).any() else pd.DatetimeIndex(test_hours).normalize().max()

    spikes = find_spikes(df, test_start, last)
    spike_list = sorted(set(spikes["page"]))
    print(f"{len(spikes)} spikes found in the test period; replay day {replay_day.date()}")

    hit = {}                 # (pred, N, h) -> list of (target_hour, hit_rate)
    spike_rank = {}          # (pred, h, target) -> {page: rank} for spike pages in the top max_n
    demo_cache = {}          # (pred, target) -> set of top demo_size pages (replay day, h=1)
    timing = {name: 0.0 for name in all_preds}

    for now in test_nows:
        lo = np.searchsorted(hour_arr, (now - pd.Timedelta(days=history_days)).to_datetime64(), side="right") \
            if history_days > 0 else 0
        hi = np.searchsorted(hour_arr, now.to_datetime64(), side="right")
        history = df.iloc[lo:hi]
        for h in horizons:
            target = now + h * HOUR
            actual = by_hour.get(target)
            if actual is None or target < test_start:
                continue
            total = actual.sum()
            for name, fn in all_preds.items():
                t0 = time.time()
                pred = actual.astype(float) if fn is None else fn(history, now, h)
                timing[name] += time.time() - t0
                if not pred.index.is_unique:
                    raise ValueError(f"predictor '{name}' returned duplicate page names at {now}")
                top = pred.dropna().nlargest(max_n).index
                # Views landing on each cached page, in rank order; cumulative sum gives every cache size at once.
                cum = np.cumsum(actual.reindex(top).fillna(0).to_numpy())

                def rate(n):
                    k = min(n, len(cum))
                    return float(cum[k - 1] / total) if k else 0.0
                for n in sizes:
                    hit.setdefault((name, n, h), []).append((target, rate(n)))
                if spike_list:
                    pos = top.get_indexer(spike_list)
                    spike_rank[(name, h, target)] = {p: r for p, r in zip(spike_list, pos) if r >= 0}
                if h == 1 and target.normalize() == replay_day:
                    demo_cache[(name, target)] = set(top[:demo_size])
                    hit.setdefault((name, demo_size, "demo"), []).append((target, rate(demo_size)))
        if now.hour % 12 == 0:
            print(f"  scored up to {now}")

    def catch_lag(name, n, h, page, s):
        for lag in range(0, MAX_LAG + 1):
            t = s + lag * HOUR
            r = spike_rank.get((name, h, t))
            if r is None:
                continue
            if r.get(page, max_n) < n:
                return lag
        return MAX_LAG

    rows = []
    for (name, n, h), vals in hit.items():
        if h == "demo":
            continue
        x = np.array([v for _, v in vals])
        lo_ci, hi_ci = bootstrap_ci(x)
        lags = [catch_lag(name, n, h, r.page, r.spike_hour) for r in spikes.itertuples()]
        rows.append({"predictor": name, "cache_size": n, "horizon": h, "hit_rate": round(float(x.mean()), 4),
                     "hit_rate_ci_low": round(lo_ci, 4), "hit_rate_ci_high": round(hi_ci, 4),
                     "median_catch_lag_h": float(np.median(lags)) if lags else float("nan"), "n_hours": len(x)})
    results = pd.DataFrame(rows).sort_values(["horizon", "cache_size", "hit_rate"], ascending=[True, True, False])

    print("time spent per predictor (s): " + ", ".join(f"{k} {v:.1f}" for k, v in timing.items()))
    demo = build_demo(results, hit, demo_cache, spikes, by_hour, replay_day, demo_size, horizons, catch_lag)
    return results, demo


def build_demo(results, hit, demo_cache, spikes, by_hour, replay_day, demo_size, horizons, catch_lag) -> dict:
    head = results[(results["horizon"] == 1) & (results["cache_size"] == demo_size)] if demo_size in set(results["cache_size"]) else None
    candidates = [p for p in {k[0] for k in hit} if p not in ("oracle", "last_hour")]

    def mean_demo(p):
        v = hit.get((p, demo_size, "demo"), [])
        return np.mean([x for _, x in v]) if v else -1
    best = max(candidates, key=mean_demo) if candidates else "last_hour"
    names = {"last_hour": "last_hour", "our_model": best}

    hours_out = []
    for t in sorted(by_hour):
        if t.normalize() != replay_day or ("last_hour", t) not in demo_cache:
            continue
        actual = by_hour[t]
        rates = {k: dict(hit[(p, demo_size, "demo")]).get(t) for k, p in names.items()}
        hours_out.append({
            "hour": iso(t),
            "hit_rate": {k: round(v, 4) for k, v in rates.items()},
            "total_views": int(actual.sum()),
            "top_pages": [{"page": pg, "views": int(v),
                           "cached": {k: pg in demo_cache[(p, t)] for k, p in names.items()}}
                          for pg, v in actual.nlargest(50).items()],
        })

    spikes_out = []
    day_spikes = spikes[spikes["spike_hour"].dt.normalize() == replay_day].sort_values("views", ascending=False) \
        if len(spikes) else spikes
    for r in day_spikes.head(10).itertuples():
        window = [r.spike_hour + k * HOUR for k in range(-2, 7)]
        spikes_out.append({
            "page": r.page, "spike_hour": iso(r.spike_hour), "hours": [iso(w) for w in window],
            "views": [int(by_hour[w].get(r.page, 0)) if w in by_hour else 0 for w in window],
            "catch_lag_h": {k: catch_lag(p, demo_size, 1, r.page, r.spike_hour) for k, p in names.items()},
        })

    def overall(p, h):
        row = results[(results["predictor"] == p) & (results["cache_size"] == demo_size) & (results["horizon"] == h)]
        return float(row["hit_rate"].iloc[0]) if len(row) else None

    return {
        "day": str(replay_day.date()),
        "predictors": ["last_hour", "our_model"],
        "our_model_name": best,
        "cache_size": demo_size,
        "hours": hours_out,
        "spikes": spikes_out,
        "summary": {
            "hit_rate": {k: overall(p, 1) for k, p in names.items()},
            "oracle_hit_rate": overall("oracle", 1),
            "foresight_curve": {"horizons": horizons,
                                "hit_rate": {k: [overall(p, h) for h in horizons] for k, p in names.items()}},
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="data/views.parquet")
    ap.add_argument("--out", default="out")
    ap.add_argument("--sizes", type=int, nargs="+", default=[1000, 10000, 100000])
    ap.add_argument("--horizons", type=int, nargs="+", default=[1, 2, 3, 6])
    ap.add_argument("--test-days", type=float, default=3)
    ap.add_argument("--history-days", type=float, default=8)
    ap.add_argument("--demo-size", type=int, default=10000)
    args = ap.parse_args()

    df = pd.read_parquet(args.data)
    sizes = sorted(set(args.sizes) | {args.demo_size})
    results, demo = run(df, PREDICTORS, sizes, args.horizons, args.test_days, args.history_days, args.demo_size)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results.to_csv(out / "results.csv", index=False)
    (out / "demo.json").write_text(json.dumps(demo, indent=2))

    print("\nHit rate, horizon 1 (higher is better):")
    h1 = results[results["horizon"] == 1].pivot(index="predictor", columns="cache_size", values="hit_rate")
    print(h1.sort_values(args.demo_size, ascending=False).to_string())
    base, orc = h1.loc["last_hour", args.demo_size], h1.loc["oracle", args.demo_size]
    gap = orc - base
    print(f"\nAt N={args.demo_size}: the standard rule (last_hour) leaves {gap:.4f} of hit rate on the table vs the oracle.")
    for p in h1.index:
        if p not in ("oracle", "last_hour") and gap > 0:
            print(f"  {p:22s} recovers {(h1.loc[p, args.demo_size] - base) / gap:+.0%} of that gap")
    lag = results[(results["horizon"] == 1) & (results["cache_size"] == args.demo_size)].set_index("predictor")["median_catch_lag_h"]
    print("\nMedian hours late catching a spike (N=%d, horizon 1): " % args.demo_size +
          ", ".join(f"{k} {v:g}" for k, v in lag.items()))
    print(f"\nwrote {out / 'results.csv'} and {out / 'demo.json'} (our_model = {demo['our_model_name']})")


if __name__ == "__main__":
    main()
