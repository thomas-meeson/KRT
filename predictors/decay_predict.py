"""Spike-decay predictor (Physics).

prediction(now + h) = baseline + excess_now * f(t + h) / f(t)
    baseline = median views over the last 24 h
    excess   = views now - baseline (floored at 0)
    t        = hours since the page's peak in the last 24 h
    f        = decay curve fitted by fit_decay.py (models/decay_params.json):
               power law (1 + t/tau)^-alpha, or exponential exp(-t/tau)
Falls back to a power law with alpha = 1, tau = 1 if no fit has been saved yet.

Same maths as Physics's original version; the 24 h table is built with numpy instead of
pivot_table (much faster), and rows are found by binary search on the sorted hour column.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

HOUR = pd.Timedelta(hours=1)
PARAMS_PATH = Path(__file__).resolve().parent.parent / "models" / "decay_params.json"
CANDIDATES = 200_000

_params = None


def _load() -> dict:
    global _params
    if _params is None:
        _params = json.loads(PARAMS_PATH.read_text()) if PARAMS_PATH.exists() else {"model": "power", "alpha": 1.0, "tau": 1.0}
    return _params


def _f(t: np.ndarray, p: dict) -> np.ndarray:
    if p["model"] == "exponential":
        return np.exp(-t / p["tau"])
    return (1 + t / p["tau"]) ** -p["alpha"]


def decay_predict(history: pd.DataFrame, now: pd.Timestamp, horizon: int = 1) -> pd.Series:
    p = _load()
    hour_col = history["hour"].to_numpy()
    lo = np.searchsorted(hour_col, np.datetime64(now - 23 * HOUR), side="left")
    hi = np.searchsorted(hour_col, np.datetime64(now), side="right")
    recent = history.iloc[lo:hi]
    if recent.empty:
        return pd.Series(dtype=float)

    codes, pages = pd.factorize(recent["page"])
    views = recent["views"].to_numpy(dtype=float)
    totals = np.bincount(codes, weights=views, minlength=len(pages))
    if len(pages) > CANDIDATES:                      # keep the busiest pages over the last 24 h
        keep = np.zeros(len(pages), bool)
        keep[np.argpartition(-totals, CANDIDATES - 1)[:CANDIDATES]] = True
    else:
        keep = np.ones(len(pages), bool)
    new_code = np.cumsum(keep) - 1
    rows = keep[codes]

    # Only hours that exist: a missing download hour must not look like a crash to 0.
    hours = pd.DatetimeIndex(np.unique(recent["hour"].to_numpy()))
    col = np.searchsorted(hours.to_numpy(), recent["hour"].to_numpy()[rows])
    V = np.zeros((int(keep.sum()), len(hours)))
    np.add.at(V, (new_code[codes[rows]], col), views[rows])

    last = V[:, -1]
    base = np.median(V, axis=1)
    peak_hour = hours[V.argmax(axis=1)]
    t = ((hours[-1] - peak_hour) / HOUR).to_numpy(float)
    t_now = t + (now - hours[-1]) / HOUR             # if `now` itself is missing, the last data is older
    excess = np.clip(last - base, 0, None)
    factor = _f(t_now + horizon, p) / _f(t, p)
    return pd.Series(np.clip(base + excess * factor, 0, None), index=pages[keep])
