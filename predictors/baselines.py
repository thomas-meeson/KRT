"""Baseline predictors. Each follows the INTERFACES.md signature:

    predict(history, now, horizon=1) -> pd.Series of predicted views for hour now+horizon, indexed by page

history only contains rows with hour <= now. Missing hours (download gaps) are handled by
falling back to the latest hour that exists.
"""
from __future__ import annotations

import pandas as pd

HOUR = pd.Timedelta(hours=1)


def _views_at(history: pd.DataFrame, hour: pd.Timestamp) -> pd.Series:
    """Views per page at one hour (empty Series if that hour is missing)."""
    rows = history[history["hour"] == hour]
    return rows.set_index("page")["views"].astype(float)


def _latest_hour(history: pd.DataFrame, now: pd.Timestamp) -> pd.Timestamp:
    """`now` if we have it, otherwise the most recent hour before it."""
    return now if (history["hour"] == now).any() else history.loc[history["hour"] <= now, "hour"].max()


def last_hour(history: pd.DataFrame, now: pd.Timestamp, horizon: int = 1) -> pd.Series:
    """Whatever was popular in the latest hour stays popular. This is the standard caching rule
    in spirit (keep what was used most recently)."""
    return _views_at(history, _latest_hour(history, now))


def last_24h_mean(history: pd.DataFrame, now: pd.Timestamp, horizon: int = 1) -> pd.Series:
    """Average views per hour over the last 24 hours (keep what is used most often).
    Pages absent in an hour count as 0; missing hours are left out of the average."""
    window = history[(history["hour"] > now - 24 * HOUR) & (history["hour"] <= now)]
    n_hours = window["hour"].nunique()
    if n_hours == 0:
        return pd.Series(dtype=float)
    return window.groupby("page")["views"].sum().astype(float) / n_hours


def same_hour_yesterday(history: pd.DataFrame, now: pd.Timestamp, horizon: int = 1) -> pd.Series:
    """Daily rhythm: the target hour will look like the same hour 24 hours earlier.
    Falls back to last_hour if that hour is missing or not yet in the past."""
    target_yesterday = now + horizon * HOUR - 24 * HOUR
    if target_yesterday > now:
        return last_hour(history, now, horizon)
    s = _views_at(history, target_yesterday)
    return s if len(s) else last_hour(history, now, horizon)
