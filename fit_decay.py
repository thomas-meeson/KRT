"""Fit how attention decays after a Wikipedia spike, for predictors/decay_predict.py.

Uses ONLY hours before the backtest's test period (same --test-days as backtest.py), so the
decay model never learns from the hours it is scored on.

Method:
  1. Find spikes in the training hours with the backtest's own rule (find_spikes).
  2. For each spike, take views from its peak (the busiest hour within 6 h of the onset) up to
     24 h later, subtract the page's baseline (median of the 24 h before the spike), and divide
     by the excess at the peak. Every spike then starts at 1 and decays towards 0.
  3. Take the median across spikes at each hour since the peak (robust to odd pages).
  4. Fit two curves to it, in log space (so the long tail counts, not just the first hours):
         power law     f(t) = (1 + t/tau) ** -alpha
         exponential   f(t) = exp(-t/tau)
     and keep the one with the smaller error.
  5. Save models/decay_params.json (read by decay_predict.py) and out/decay_fit.png (for the slides).

Usage:
    python fit_decay.py                       # matches python backtest.py (3 test days)
    python fit_decay.py --test-days 0.5       # matches python backtest.py --test-days 0.5
"""
from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

from backtest import HOUR, find_spikes

MAX_T = 24          # hours after the peak used for fitting


def power(t, alpha, tau):
    return (1 + t / tau) ** -alpha


def exponential(t, tau):
    return np.exp(-t / tau)


def spike_curves(df: pd.DataFrame, train_end: pd.Timestamp) -> tuple[np.ndarray, int]:
    """Normalised excess-views curves (n_spikes, MAX_T + 1), NaN where unknown."""
    first = df["hour"].min() + 24 * HOUR
    spikes = find_spikes(df, first, train_end)
    if spikes.empty:
        raise SystemExit("no spikes in the training hours; download more data or lower --test-days")
    pages = set(spikes["page"])
    sub = df[df["page"].isin(pages) & (df["hour"] <= train_end)]
    full = pd.date_range(df["hour"].min(), train_end, freq="h")
    have = set(pd.DatetimeIndex(df.loc[df["hour"] <= train_end, "hour"].unique()))
    wide = sub.pivot_table(index="hour", columns="page", values="views", aggfunc="sum").reindex(full)
    missing_hour = ~full.isin(list(have))
    wide = wide.fillna(0.0)                       # page absent in an hour we have = 0 views...
    wide.loc[missing_hour] = np.nan               # ...but a missing download hour stays unknown

    curves = []
    for r in spikes.itertuples():
        col = wide[r.page].to_numpy()
        i = full.get_loc(r.spike_hour)
        baseline = np.nanmedian(col[max(0, i - 24):i]) if i > 0 else 0.0
        window = col[i:i + 7]
        if np.all(np.isnan(window)):
            continue
        p = i + int(np.nanargmax(window))         # peak = busiest hour within 6 h of the onset
        peak_excess = col[p] - baseline
        if not peak_excess > 0:
            continue
        seg = np.full(MAX_T + 1, np.nan)
        after = col[p:p + MAX_T + 1]
        seg[:len(after)] = np.clip(after - baseline, 0, None) / peak_excess
        curves.append(seg)
    return np.array(curves), len(spikes)


def fit(curves: np.ndarray) -> dict:
    t = np.arange(MAX_T + 1, dtype=float)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # hours with no spike data yet
        med = np.nanmedian(curves, axis=0)
    n_per_t = np.sum(~np.isnan(curves), axis=0)
    ok = (med > 0) & (n_per_t >= 5)
    if ok.sum() < 4:
        raise SystemExit("not enough spike data to fit a curve yet")
    tt, yy = t[ok], np.log(med[ok])
    res = {}
    (a, tau_p), _ = curve_fit(lambda x, a, tau: np.log(power(x, a, tau)), tt, yy, p0=[1.0, 1.0],
                              bounds=([0.01, 0.01], [10.0, 100.0]))
    res["power"] = {"alpha": float(a), "tau": float(tau_p),
                    "rmse_log": float(np.sqrt(np.mean((np.log(power(tt, a, tau_p)) - yy) ** 2)))}
    (tau_e,), _ = curve_fit(lambda x, tau: np.log(exponential(x, tau)), tt, yy, p0=[3.0], bounds=([0.01], [500.0]))
    res["exponential"] = {"tau": float(tau_e),
                          "rmse_log": float(np.sqrt(np.mean((np.log(exponential(tt, tau_e)) - yy) ** 2)))}
    best = min(res, key=lambda k: res[k]["rmse_log"])
    p = res[best]
    half_life = p["tau"] * (2 ** (1 / p["alpha"]) - 1) if best == "power" else p["tau"] * np.log(2)
    return {"model": best, "alpha": p.get("alpha", 1.0), "tau": p["tau"], "half_life_h": float(half_life),
            "candidates": res, "median_curve": [None if np.isnan(x) else float(x) for x in med],
            "spikes_per_hour": n_per_t.tolist()}


def plot(params: dict, out: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t = np.arange(MAX_T + 1, dtype=float)
    med = np.array([np.nan if x is None else x for x in params["median_curve"]])
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    ok = med > 0
    ax.loglog(t[ok] + 1, med[ok], "o", color="black", label=f"median of {params['n_spikes_used']} real spikes")
    tf = np.linspace(0, MAX_T, 200)
    c = params["candidates"]
    ax.loglog(tf + 1, power(tf, c["power"]["alpha"], c["power"]["tau"]), "-",
              label=f"power law: alpha={c['power']['alpha']:.2f}, tau={c['power']['tau']:.2f}")
    ax.loglog(tf + 1, exponential(tf, c["exponential"]["tau"]), "--",
              label=f"exponential: tau={c['exponential']['tau']:.2f} h")
    ax.set_xlabel("hours since peak + 1")
    ax.set_ylabel("extra views, as a fraction of the peak")
    ax.set_title(f"How Wikipedia attention fades (half-life {params['half_life_h']:.1f} h, best: {params['model']})")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out, dpi=140)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="data/views.parquet")
    ap.add_argument("--test-days", type=float, default=3, help="must match backtest.py")
    ap.add_argument("--top", type=int, default=150_000, help="keep top N pages per hour (as backtest.py)")
    args = ap.parse_args()

    df = pd.read_parquet(args.data)
    if args.top:
        df = df.sort_values(["hour", "views"], ascending=[True, False]).groupby("hour", sort=False).head(args.top)
    last = df["hour"].max()
    test_start = last - pd.Timedelta(days=args.test_days) + HOUR       # same rule as backtest.py
    train_end = test_start - HOUR
    print(f"fitting on hours up to {train_end} (test period starts {test_start}, never used here)")

    curves, n_spikes = spike_curves(df[df["hour"] <= train_end], train_end)
    params = fit(curves)
    params.update({"n_spikes_found": int(n_spikes), "n_spikes_used": int(len(curves)),
                   "fitted_up_to": str(train_end), "test_days": args.test_days})

    Path("models").mkdir(exist_ok=True)
    Path("out").mkdir(exist_ok=True)
    Path("models/decay_params.json").write_text(json.dumps(params, indent=2))
    plot(params, Path("out/decay_fit.png"))
    c = params["candidates"]
    print(f"{len(curves)} spikes used (of {n_spikes} found)")
    print(f"power law:   alpha={c['power']['alpha']:.3f}, tau={c['power']['tau']:.3f}  (log error {c['power']['rmse_log']:.3f})")
    print(f"exponential: tau={c['exponential']['tau']:.3f} h  (log error {c['exponential']['rmse_log']:.3f})")
    print(f"best: {params['model']}, half-life of attention {params['half_life_h']:.1f} h")
    print("wrote models/decay_params.json and out/decay_fit.png")


if __name__ == "__main__":
    main()
