"""Serve the supplied results; no predictors or backtests run here.

    python -m pip install -r requirements.txt
    python -m uvicorn api:app --host 127.0.0.1 --port 8000
    open http://127.0.0.1:8000/demo/#start

Existing endpoints (response shapes retained):
    GET /api/demo              full replay (root demo.json, then out/demo.json fallback)
    GET /api/hours             replay hour index, rates and scope
    GET /api/hours/{i}         one replay hour
    GET /api/spikes            supplied spike records
    GET /api/summary           supplied replay summary
    GET /api/results           results rows; optional horizon/cache_size filters
    GET /charts/{file}         out/charts assets
Decision explorer and article lookup (used by the website in demo/):
    GET /api/compare?cache_size=100000&horizon=1
        cache_size 1000/10000/100000, horizon 1/2/3/6, else 422. Returns
        {cache_size, horizon, methods: {last_hour, xgboost, oracle: results.csv row | null},
         value_metrics: value_metrics.csv xgboost row | null,
         series: [{hour, last_hour, xgboost, oracle}] from hourly.csv, sources}
    GET /api/pages?q=tom       {pages: [...]} titles present in demo.json (maximum 50)
    GET /api/page/{title}      {page, day, cache_size, horizon, our_model_name, observations[24], spikes}
        spaces/underscores and case are normalised; unknown titles return 404.
    GET /api/tape              {day, cache_size, horizon, predictors, our_model_name, hours: [{hour, hit_rate,
        total_views, rows, missed, disagreements: [{page, views, cached}], edge_views}]}
        top-50 rows where the methods' demo.json cache choices differ (Live cache desk);
        edge_views = views of those rows only our model had cached minus those only the rule had.
Static files:
    GET /demo/                 the website (published-data demo, enhanced when this API is present)
    GET /demo.json, /out/...   the exact published files the website verifies by SHA-256
    GET /                      redirects to /demo/

JSON/CSV inputs are read once per application startup. Restart to refresh.
Missing inputs return 503; missing observations/metrics are null, never estimates.
"""
from __future__ import annotations

import csv
import json
import math
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
METHODS = ('last_hour', 'xgboost', 'oracle')


def read_csv(path):
    def value(text):
        if text is None or not text.strip():
            return None
        try:
            number = float(text)
            return number if math.isfinite(number) else None
        except ValueError:
            return text
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return [{key: value(val) for key, val in row.items()} for row in csv.DictReader(stream)]


class DataStore:
    def __init__(self, root):
        self.data, self.errors = {}, {}
        self.replay_bytes = None
        for key, candidates in {
            'demo': [root / 'demo.json', root / 'out/demo.json'],
            'results': [root / 'out/results.csv'],
            'hourly': [root / 'out/hourly.csv'],
            'value_metrics': [root / 'out/value_metrics.csv'],
        }.items():
            path = next((p for p in candidates if p.exists()), candidates[0])
            try:
                if key == 'demo':
                    self.replay_bytes = path.read_bytes()
                    self.data[key] = json.loads(self.replay_bytes.decode('utf-8-sig'))
                else:
                    self.data[key] = read_csv(path)
            except (OSError, ValueError, csv.Error):
                self.errors[key] = f'{path.name} unavailable; restore the supplied file and restart the server.'
        self.pages = {}
        d = self.data.get('demo', {})
        for hour in d.get('hours', []):
            for page in hour.get('top_pages', []):
                self.pages.setdefault(page['page'], {})[hour['hour']] = page
        for spike in d.get('spikes', []):
            self.pages.setdefault(spike['page'], {})

    def require(self, name):
        if name not in self.data:
            raise HTTPException(503, self.errors.get(name, f'{name} unavailable'))
        return self.data[name]


@asynccontextmanager
async def lifespan(app):
    app.state.store = DataStore(ROOT)
    yield


app = FastAPI(title='Ahead of the Spike', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['GET'], allow_headers=['*'])


def demo():
    return app.state.store.require('demo')


@app.get('/api/demo')
def get_demo():
    return demo()


@app.get('/api/hours')
def get_hours():
    d = demo()
    return {'day': d['day'], 'predictors': d['predictors'], 'our_model_name': d.get('our_model_name'),
            'cache_size': d['cache_size'],
            'hours': [{'i': i, 'hour': h['hour'], 'hit_rate': h['hit_rate'], 'total_views': h['total_views']}
                      for i, h in enumerate(d['hours'])]}


@app.get('/api/hours/{i}')
def get_hour(i: int):
    hours = demo()['hours']
    if not 0 <= i < len(hours):
        raise HTTPException(404, f'hour index must be 0..{len(hours) - 1}')
    return hours[i]


@app.get('/api/spikes')
def get_spikes():
    return demo()['spikes']


@app.get('/api/summary')
def get_summary():
    d = demo()
    return {'our_model_name': d.get('our_model_name'), **d['summary']}


@app.get('/api/results')
def get_results(horizon: int | None = None, cache_size: int | None = None):
    return [r for r in app.state.store.require('results')
            if (horizon is None or r['horizon'] == horizon)
            and (cache_size is None or r['cache_size'] == cache_size)]


def one_or_none(rows):
    if len(rows) > 1:
        raise HTTPException(503, 'Duplicate published rows; comparison unavailable.')
    return rows[0] if rows else None


@app.get('/api/compare')
def compare(cache_size: int = 100000, horizon: int = 1):
    if cache_size not in (1000, 10000, 100000) or horizon not in (1, 2, 3, 6):
        raise HTTPException(422, 'Choose cache_size 1000/10000/100000 and horizon 1/2/3/6.')
    store = app.state.store
    rows = get_results(horizon, cache_size)
    methods = {m: one_or_none([r for r in rows if r['predictor'] == m]) for m in METHODS}
    metrics = one_or_none([r for r in store.data.get('value_metrics', [])
                           if r['model'] == 'xgboost' and r['cache_size'] == cache_size and r['horizon'] == horizon])
    # Metrics are published values, not recomputed from rounded rates or the chart.
    if metrics and (not methods['xgboost'] or not methods['last_hour']
                    or metrics['hit_rate'] != methods['xgboost']['hit_rate']
                    or metrics['standard_rule'] != methods['last_hour']['hit_rate']):
        raise HTTPException(503, 'Published metrics do not match results; comparison unavailable.')
    series = {}
    for row in store.require('hourly'):
        if row['cache_size'] != cache_size or row['horizon'] != horizon or row['predictor'] not in METHODS:
            continue
        hour = row['target_hour'].replace(' ', 'T') + 'Z'
        point = series.setdefault(hour, {'hour': hour, **dict.fromkeys(METHODS)})
        if point[row['predictor']] is not None:
            raise HTTPException(503, 'Duplicate hourly result; comparison unavailable.')
        point[row['predictor']] = row['hit_rate']
    return {'cache_size': cache_size, 'horizon': horizon, 'methods': methods,
            'value_metrics': metrics, 'series': [series[h] for h in sorted(series)],
            'sources': ['out/results.csv', 'out/value_metrics.csv', 'out/hourly.csv']}


@app.get('/api/pages')
def pages(q: str = Query('', max_length=200)):
    app.state.store.require('demo')
    query = q.strip().replace(' ', '_').casefold()
    return {'pages': [title for title in sorted(app.state.store.pages)
                      if query in title.casefold()][:50]}


@app.get('/api/page/{title:path}')
def page(title: str):
    d = demo()
    title = title.replace(' ', '_')
    title = next((p for p in app.state.store.pages if p.casefold() == title.casefold()), title)
    if title not in app.state.store.pages:
        raise HTTPException(404, 'This article is not available in the recorded demo dataset.')
    records = app.state.store.pages[title]
    spikes = [s for s in d.get('spikes', []) if s['page'] == title]
    observations = []
    start = datetime.fromisoformat(d['day']).replace(tzinfo=timezone.utc)
    for index in range(24):
        hour = (start + timedelta(hours=index)).isoformat().replace('+00:00', 'Z')
        record = records.get(hour)
        views = record.get('views') if record else None
        source = 'top_pages' if record else None
        if record is None:
            for spike in spikes:
                if hour in spike['hours']:
                    supplied = spike['views'][spike['hours'].index(hour)]
                    # Contract uses zero as a missing/outside-coverage sentinel in spike arrays.
                    if supplied > 0:
                        views, source = supplied, 'spike'
                        break
        observations.append({'hour': hour, 'views': views, 'source': source,
                             'cached': {m: (record.get('cached', {}).get(m) if record else None)
                                        for m in d['predictors']}})
    return {'page': title, 'day': d['day'], 'cache_size': d['cache_size'], 'horizon': 1,
            'our_model_name': d.get('our_model_name'), 'observations': observations, 'spikes': spikes}


@app.get('/api/tape')
def tape():
    """Replay hours with the top-50 rows where the two methods' cache choices differ."""
    d = demo()
    keys = d['predictors']
    hours = []
    for h in sorted(d['hours'], key=lambda item: item['hour']):
        rows = [p for p in h.get('top_pages', []) if isinstance(p.get('cached'), dict)
                and all(isinstance(p['cached'].get(k), bool) for k in keys)]
        split = sorted((p for p in rows if len({p['cached'][k] for k in keys}) > 1),
                       key=lambda p: -p['views'])
        edge = None
        if {'last_hour', 'our_model'} <= set(keys):
            edge = sum(p['views'] if p['cached']['our_model'] else -p['views'] for p in split)
        hours.append({'hour': h['hour'], 'hit_rate': h.get('hit_rate'), 'total_views': h.get('total_views'),
                      'rows': len(rows), 'missed': {k: sum(not p['cached'][k] for p in rows) for k in keys},
                      'disagreements': [{'page': p['page'], 'views': p['views'], 'cached': p['cached']} for p in split],
                      'edge_views': edge})
    return {'day': d['day'], 'cache_size': d['cache_size'], 'horizon': 1, 'predictors': keys,
            'our_model_name': d.get('our_model_name'), 'hours': hours}


@app.get('/', include_in_schema=False)
def home():
    return RedirectResponse('/demo/')


@app.get('/demo.json', include_in_schema=False)
def replay_file():
    demo()
    return Response(app.state.store.replay_bytes, media_type='application/json')


if (OUT / 'charts').is_dir():
    app.mount('/charts', StaticFiles(directory=OUT / 'charts'), name='charts')
if OUT.is_dir():
    app.mount('/out', StaticFiles(directory=OUT), name='published-outputs')
if (ROOT / 'demo').is_dir():
    app.mount('/demo', StaticFiles(directory=ROOT / 'demo', html=True), name='published-demo')
    app.mount('/', StaticFiles(directory=ROOT / 'demo', html=True), name='demo')
