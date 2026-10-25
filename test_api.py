"""Endpoint checks against the published files: python -m pytest test_api.py (or python test_api.py)."""
import pytest
from fastapi.testclient import TestClient

from api import app

SIZES, HORIZONS = (1000, 10000, 100000), (1, 2, 3, 6)


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize('size', SIZES)
@pytest.mark.parametrize('horizon', HORIZONS)
def test_compare_valid(client, size, horizon):
    r = client.get('/api/compare', params={'cache_size': size, 'horizon': horizon})
    assert r.status_code == 200
    d = r.json()
    assert (d['cache_size'], d['horizon']) == (size, horizon)
    for m in ('last_hour', 'xgboost', 'oracle'):
        row = d['methods'][m]
        assert row['predictor'] == m and 0 <= row['hit_rate'] <= 1
        assert row['hit_rate_ci_low'] <= row['hit_rate'] <= row['hit_rate_ci_high']
    vm = d['value_metrics']
    assert vm['hit_rate'] == d['methods']['xgboost']['hit_rate']
    assert vm['standard_rule'] == d['methods']['last_hour']['hit_rate']
    n = int(d['methods']['xgboost']['n_hours'])
    assert len(d['series']) == n == int(vm['hours'])
    assert all(p['hour'].endswith('Z') for p in d['series'])
    assert [p['hour'] for p in d['series']] == sorted(p['hour'] for p in d['series'])


def test_headline_100k(client):
    one = client.get('/api/compare?cache_size=100000&horizon=1').json()
    assert one['methods']['xgboost']['hit_rate'] == 0.8661
    assert one['methods']['last_hour']['hit_rate'] == 0.8522
    assert round(one['value_metrics']['miss_reduction_pct'], 1) == 9.4
    assert one['value_metrics']['hours_won'] == 72 and one['value_metrics']['hours_lost'] == 0
    assert all(p['xgboost'] > p['last_hour'] for p in one['series'])
    six = client.get('/api/compare?cache_size=100000&horizon=6').json()
    assert round(six['value_metrics']['miss_reduction_pct'], 1) == 17.1
    assert six['value_metrics']['hours_won'] == six['value_metrics']['hours'] == 67


@pytest.mark.parametrize('query', ['cache_size=5000&horizon=1', 'cache_size=0&horizon=1',
                                   'cache_size=100000&horizon=4', 'cache_size=100000&horizon=0',
                                   'cache_size=abc&horizon=1', 'cache_size=100000&horizon=x'])
def test_compare_invalid(client, query):
    assert client.get(f'/api/compare?{query}').status_code == 422


@pytest.mark.parametrize('path', ['/api/demo', '/api/hours', '/api/hours/0', '/api/spikes',
                                  '/api/summary', '/api/results', '/demo.json', '/demo/',
                                  '/demo/run-metadata.json', '/out/results.csv', '/out/hourly.csv'])
def test_existing_endpoints(client, path):
    assert client.get(path).status_code == 200


def test_existing_shapes(client):
    assert client.get('/api/hours/99').status_code == 404
    rows = client.get('/api/results?horizon=1&cache_size=100000').json()
    assert rows and all(r['horizon'] == 1 and r['cache_size'] == 100000 for r in rows)
    with open('demo.json', 'rb') as f:
        assert client.get('/demo.json').content == f.read()
    assert client.get('/', follow_redirects=False).headers['location'] == '/demo/'


def test_search(client):
    pages = client.get('/api/pages?q=tom').json()['pages']
    assert 'Tom_Skerritt' in pages and len(pages) <= 50
    assert all('tom' in p.casefold() for p in pages)
    assert 'Tom_Skerritt' in client.get('/api/pages?q=tom skerritt').json()['pages']
    assert client.get('/api/pages?q=zzzz-not-a-page').json() == {'pages': []}
    assert len(client.get('/api/pages').json()['pages']) == 50


@pytest.mark.parametrize('title', ['Tom_Skerritt', 'Tom Skerritt', 'tom_skerritt', 'Tom%20Skerritt'])
def test_page_lookup(client, title):
    d = client.get(f'/api/page/{title}').json()
    assert d['page'] == 'Tom_Skerritt' and len(d['observations']) == 24
    assert d['spikes'] and d['spikes'][0]['page'] == 'Tom_Skerritt'
    for o in d['observations']:
        assert set(o['cached']) == {'last_hour', 'our_model'}
        if o['views'] is None:
            assert o['source'] is None and all(v is None for v in o['cached'].values())


def test_tape(client):
    d = client.get('/api/tape').json()
    assert d['cache_size'] == 10000 and len(d['hours']) == 24
    assert [h['hour'] for h in d['hours']] == sorted(h['hour'] for h in d['hours'])
    replay = {h['hour']: h for h in client.get('/api/demo').json()['hours']}
    total_split = 0
    for hour in d['hours']:
        rows = {p['page']: p for p in replay[hour['hour']]['top_pages']}
        assert hour['hit_rate'] == replay[hour['hour']]['hit_rate']
        for split in hour['disagreements']:
            assert split['cached']['last_hour'] != split['cached']['our_model']
            assert rows[split['page']]['views'] == split['views']
        assert hour['edge_views'] == sum(s['views'] if s['cached']['our_model'] else -s['views']
                                         for s in hour['disagreements'])
        total_split += len(hour['disagreements'])
    assert total_split > 0


def test_page_unknown(client):
    r = client.get('/api/page/Definitely_Not_A_Recorded_Article')
    assert r.status_code == 404
    assert r.json()['detail'] == 'This article is not available in the recorded demo dataset.'
    assert client.get('/api/page/..%2F..%2Fapi.py').status_code == 404


if __name__ == '__main__':
    raise SystemExit(pytest.main([__file__, '-q']))
