"""api.py  (EIE) -- serves the backtest outputs to the demo.

    pip install fastapi uvicorn pandas
    uvicorn api:app --reload --port 8000

Endpoints (all read the files fresh, so re-running backtest.py updates the demo with no restart):
    GET /api/demo              the whole out/demo.json (INTERFACES.md section 4)
    GET /api/hours             list of replay hours with both hit rates (for the counter / timeline)
    GET /api/hours/{i}         one replay hour: leaderboard of top pages, cached green/red
    GET /api/spikes            the spike stories
    GET /api/results           out/results.csv as JSON (optionally ?horizon=1&cache_size=10000)
    GET /charts/<file>         the PNGs in out/charts/
    GET /                      the demo front end, if Design Eng's files are in demo/
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"

app = FastAPI(title="Ahead of the Spike")
# The demo may be served from another port (e.g. a Vite/React dev server), so allow any origin.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def demo() -> dict:
    path = OUT / "demo.json"
    if not path.exists():
        raise HTTPException(503, "out/demo.json not found; run python backtest.py first")
    return json.loads(path.read_text())


@app.get("/api/demo")
def get_demo():
    return demo()


@app.get("/api/hours")
def get_hours():
    d = demo()
    return {"day": d["day"], "predictors": d["predictors"], "our_model_name": d.get("our_model_name"),
            "cache_size": d["cache_size"],
            "hours": [{"i": i, "hour": h["hour"], "hit_rate": h["hit_rate"], "total_views": h["total_views"]}
                      for i, h in enumerate(d["hours"])]}


@app.get("/api/hours/{i}")
def get_hour(i: int):
    hours = demo()["hours"]
    if not 0 <= i < len(hours):
        raise HTTPException(404, f"hour index must be 0..{len(hours) - 1}")
    return hours[i]


@app.get("/api/spikes")
def get_spikes():
    return demo()["spikes"]


@app.get("/api/summary")
def get_summary():
    d = demo()
    return {"our_model_name": d.get("our_model_name"), **d["summary"]}


@app.get("/api/results")
def get_results(horizon: int | None = None, cache_size: int | None = None):
    path = OUT / "results.csv"
    if not path.exists():
        raise HTTPException(503, "out/results.csv not found; run python backtest.py first")
    df = pd.read_csv(path)
    if horizon is not None:
        df = df[df["horizon"] == horizon]
    if cache_size is not None:
        df = df[df["cache_size"] == cache_size]
    return json.loads(df.to_json(orient="records"))


if (OUT / "charts").is_dir():
    app.mount("/charts", StaticFiles(directory=OUT / "charts"), name="charts")
if (ROOT / "demo").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "demo", html=True), name="demo")
