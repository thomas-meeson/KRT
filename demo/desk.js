'use strict';

// Live cache desk: the published held-out hours streamed one at a time, plus diagnostics.
// Every value comes from /api/compare (results.csv, hourly.csv, value_metrics.csv) or /api/tape (demo.json).
const DESK_FRAME_MS = 1200;
const DESK_SIZES = [1000, 10000, 100000];
const DESK_HORIZONS = [1, 2, 3, 6];
let deskCapacity = 100000;
let deskHorizon = 1;
let deskResult = null;
let deskSeries = [];
let deskIndex = 0;
let deskTimer = null;
let deskToken = 0;
const deskPoints = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
const deskShort = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function deskShape(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

function deskMessage(text) {
  element('desk-status').textContent = text;
  element('desk-status').hidden = !text;
}

async function initDesk() {
  if (!apiAvailable) {
    deskMessage('The live cache desk needs the local API server. Start it with: uvicorn api:app --port 8000, then open http://127.0.0.1:8000/demo/#desk.');
    element('desk-body').hidden = true;
    return;
  }
  element('desk-body').hidden = false;
  deskMessage('');
  refreshDesk();
  renderDeskEdge();
  renderDeskConfigs();
}

async function refreshDesk() {
  const token = ++deskToken;
  pauseDesk();
  document.querySelectorAll('[name="desk-capacity"],[name="desk-horizon"]').forEach(input => {
    input.checked = Number(input.value) === (input.name === 'desk-capacity' ? deskCapacity : deskHorizon);
  });
  try {
    const result = await getCompare(deskCapacity, deskHorizon);
    if (token !== deskToken) return;
    deskResult = result;
    deskSeries = (Array.isArray(result.series) ? result.series : [])
      .map(point => ({ hour: point.hour, time: Date.parse(point.hour), last_hour: rateOrNull(point.last_hour), xgboost: rateOrNull(point.xgboost), oracle: rateOrNull(point.oracle) }))
      .filter(point => Number.isFinite(point.time)).sort((a, b) => a.time - b.time);
    deskIndex = Math.min(deskIndex, Math.max(0, deskSeries.length - 1));
    deskMessage(deskSeries.length ? '' : 'No hourly results are available for this configuration.');
    renderDeskTape();
    renderDeskRegret();
    renderDeskSignificance();
    highlightDeskConfig();
  } catch (error) {
    if (token !== deskToken) return;
    deskMessage(`Not available: ${error.message}`);
  }
}

function renderDeskTape() {
  const points = deskSeries;
  const point = points[deskIndex];
  const model = modelLabel(replay?.data || {}, 'our_model');
  element('desk-scope').textContent = `${number.format(deskCapacity)} pages · decided ${deskHorizon} h ahead`;
  const timeline = element('desk-timeline');
  timeline.max = Math.max(0, points.length - 1);
  timeline.value = deskIndex;
  timeline.disabled = points.length < 2;
  element('desk-previous').disabled = deskIndex === 0;
  element('desk-next').disabled = deskIndex >= points.length - 1;
  element('desk-play').textContent = deskTimer !== null ? 'Pause' : deskIndex >= points.length - 1 && points.length > 1 ? 'Replay hours' : 'Play';
  element('desk-state').textContent = deskTimer !== null ? 'Streaming · 1 test hour per tick' : 'Paused';
  if (!point) return;
  timeline.setAttribute('aria-valuetext', `${dateTime.format(new Date(point.time))} UTC, hour ${deskIndex + 1} of ${points.length}`);
  element('desk-start').textContent = `${deskShort.format(new Date(points[0].time))} UTC`;
  element('desk-end').textContent = `${deskShort.format(new Date(points[points.length - 1].time))} UTC`;
  element('desk-hour').dateTime = point.hour;
  element('desk-hour').textContent = `${dateTime.format(new Date(point.time))} UTC`;
  element('desk-position').textContent = `Test hour ${deskIndex + 1} of ${points.length}. Recorded on this date; replayed now.`;

  const counters = element('desk-counters');
  counters.replaceChildren();
  for (const [key, label, note] of [['last_hour', 'Standard rule', 'Latest observed popularity'], ['xgboost', model, 'Forecast demand'], ['oracle', 'Perfect hindsight', 'Ceiling, not usable in advance']]) {
    const value = point[key];
    const card = node('section', undefined, `model desk-${key}`);
    const title = node('h3', label, 'model-label');
    title.append(node('span', note));
    card.append(title, node('p', value === null ? 'Not available' : percent.format(value), `rate${value === null ? ' unavailable' : ''}`));
    if (value !== null) {
      const meter = node('div', undefined, 'meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = node('div', undefined, 'meter-fill');
      fill.style.width = `${value * 100}%`;
      meter.append(fill);
      card.append(meter);
    }
    counters.append(card);
  }

  const seen = points.slice(0, deskIndex + 1).filter(p => p.xgboost !== null && p.last_hour !== null);
  const won = seen.filter(p => p.xgboost > p.last_hour).length;
  const lost = seen.filter(p => p.xgboost < p.last_hour).length;
  const running = element('desk-running');
  running.replaceChildren();
  const item = (title, value, note) => {
    const box = node('div', undefined, 'summary-item');
    box.append(node('dt', title), node('dd', value), node('p', note));
    running.append(box);
  };
  const gap = point.xgboost !== null && point.last_hour !== null ? (point.xgboost - point.last_hour) * 100 : null;
  item('This hour', gap === null ? 'Not available' : `${deskPoints(gap)} points`, 'Model minus standard rule, from the published hourly rates');
  item('Hours won so far', `${won} of ${seen.length}`, lost ? `Standard rule ahead in ${lost} so far` : 'No hours lost so far');
  const regret = point.oracle !== null && point.xgboost !== null ? (point.oracle - point.xgboost) * 100 : null;
  item('Model regret this hour', regret === null ? 'Not available' : `${regret.toFixed(2)} points`, 'Views perfect hindsight would also have served');

  const log = element('desk-log');
  log.replaceChildren();
  for (const entry of points.slice(Math.max(0, deskIndex - 7), deskIndex + 1).reverse()) {
    const li = node('li');
    const delta = entry.xgboost !== null && entry.last_hour !== null ? (entry.xgboost - entry.last_hour) * 100 : null;
    li.append(node('time', `${deskShort.format(new Date(entry.time))} UTC`),
      node('span', `rule ${entry.last_hour === null ? 'n/a' : percent.format(entry.last_hour)} · model ${entry.xgboost === null ? 'n/a' : percent.format(entry.xgboost)}`),
      node('strong', delta === null ? 'n/a' : `${deskPoints(delta)} pts`, delta === null ? '' : delta > 0 ? 'desk-win' : delta < 0 ? 'desk-loss' : ''));
    log.append(li);
  }
}

function pauseDesk() {
  clearInterval(deskTimer);
  deskTimer = null;
  if (deskSeries.length) renderDeskTape();
}

function selectDeskHour(index) {
  pauseDesk();
  deskIndex = Math.max(0, Math.min(deskSeries.length - 1, index));
  renderDeskTape();
}

function toggleDesk() {
  if (deskSeries.length < 2) return;
  if (deskTimer !== null) return pauseDesk();
  if (deskIndex >= deskSeries.length - 1) deskIndex = 0;
  deskTimer = setInterval(() => {
    deskIndex += 1;
    if (deskIndex >= deskSeries.length - 1) {
      deskIndex = deskSeries.length - 1;
      clearInterval(deskTimer);
      deskTimer = null;
    }
    renderDeskTape();
  }, DESK_FRAME_MS);
  renderDeskTape();
}

async function renderDeskEdge() {
  const box = element('desk-edge');
  box.replaceChildren(node('p', 'Loading the replay day…', 'metric-note'));
  let tape;
  try { tape = await apiGet('tape'); } catch (error) {
    box.replaceChildren(node('p', `Not available: ${error.message}`, 'metric-note'));
    return;
  }
  const hours = Array.isArray(tape.hours) ? tape.hours : [];
  const rows = hours.reduce((sum, hour) => sum + (isCount(hour.rows) ? hour.rows : 0), 0);
  const splits = hours.flatMap(hour => (hour.disagreements || []).map(split => ({ ...split, hour: hour.hour })));
  const model = modelLabel(tape, 'our_model');
  box.replaceChildren();
  const headline = node('div', undefined, 'result-explainer');
  headline.append(node('strong', `The two methods made the same choice for ${number.format(rows - splits.length)} of ${number.format(rows)} top-50 article rows.`),
    node('p', `Replay day ${tape.day}, caches of ${number.format(tape.cache_size)} pages chosen ${tape.horizon} hour ahead, from the per-article cache flags in demo.json (the only capacity at which they were published).`));
  box.append(headline);
  if (splits.length) {
    const table = node('table');
    table.append(node('caption', `Every top-50 row where the choices differed (${splits.length})`));
    const head = node('tr');
    ['Hour (UTC)', 'Article', 'Views', 'Standard rule', model].forEach(label => { const th = node('th', label); th.scope = 'col'; head.append(th); });
    const thead = node('thead');
    thead.append(head);
    const body = node('tbody');
    for (const split of splits) {
      const tr = node('tr');
      tr.append(node('td', split.hour.slice(11, 16)), node('th', split.page.replaceAll('_', ' ')), node('td', number.format(split.views), 'views'));
      for (const key of ['last_hour', 'our_model']) {
        const cell = node('td', undefined, 'cache');
        const cached = split.cached?.[key];
        cell.append(node('span', cached ? '✓ Ready' : '× Not ready', `badge${cached ? '' : ' missed'}`));
        tr.append(cell);
      }
      body.append(tr);
    }
    table.append(thead, body);
    const wrap = node('div', undefined, 'table-scroll');
    wrap.append(table);
    box.append(wrap);
  }
  box.append(node('p', 'Both methods keep the most-read articles, so the top of the leaderboard barely separates them. The model’s measured advantage therefore comes from the many less-read pages further down the ranking. The team’s 100,000 page analysis reaches the same conclusion: the gain comes from ordinary, non-spiking pages.', 'section-copy'));
}

function renderDeskRegret() {
  const methods = deskResult?.methods || {};
  const metrics = deskResult?.value_metrics || {};
  const oracle = rateOrNull(methods.oracle?.hit_rate);
  const model = modelLabel(replay?.data || {}, 'our_model');
  const cards = element('desk-regret-cards');
  cards.replaceChildren();
  const card = (title, value, note, className) => {
    const box = node('div', undefined, `horizon-score ${className}`);
    box.append(node('h3', title), node('p', value, 'interactive-rate'), node('p', note, 'metric-note'));
    cards.append(box);
  };
  for (const [key, label, className] of [['last_hour', 'Standard rule', 'score-last_hour'], ['xgboost', model, 'score-xgboost']]) {
    const rate = rateOrNull(methods[key]?.hit_rate);
    card(`${label} regret`, oracle === null || rate === null ? 'Not available' : `${((oracle - rate) * 100).toFixed(2)} pts`, 'Perfect hindsight average minus this method’s average (results.csv)', className);
  }
  const gap = finiteOrNull(metrics.gap_closed_pct);
  card('Regret removed by the model', gap === null ? 'Not available' : `${Math.round(gap)}%`, 'Share of the standard rule’s gap to perfect hindsight that the model closes (value_metrics.csv)', 'score-oracle');

  const svg = element('desk-regret');
  svg.replaceChildren();
  const keys = [['last_hour', 'Standard rule', '#202122', '7 4'], ['xgboost', model, '#36c', '']];
  const values = deskSeries.flatMap(p => keys.map(([key]) => p.oracle !== null && p[key] !== null ? (p.oracle - p[key]) * 100 : null)).filter(v => v !== null);
  const legend = element('desk-regret-legend');
  legend.replaceChildren();
  if (!values.length) return;
  const top = Math.max(1, Math.ceil(Math.max(...values)));
  const start = deskSeries[0].time;
  const span = Math.max(deskSeries[deskSeries.length - 1].time - start, 3600000);
  const x = time => 70 + (time - start) / span * 660;
  const y = value => 250 - Math.max(0, value) / top * 210;
  svg.append(deskShape('title', { id: 'desk-regret-chart-title' }, 'Hourly regret against perfect hindsight, percentage points'),
    deskShape('desc', {}, `Axis from 0 to ${top} percentage points. One point per evaluated hour; lower is better.`));
  for (let i = 0; i <= 4; i++) {
    const value = top * i / 4;
    svg.append(deskShape('line', { x1: 70, x2: 730, y1: y(value), y2: y(value), stroke: '#eaecf0' }), deskShape('text', { x: 60, y: y(value) + 4, 'text-anchor': 'end' }, `${value.toFixed(1)}`));
  }
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  deskSeries.filter(p => p.hour.endsWith('T00:00:00Z')).forEach(p => svg.append(deskShape('text', { x: x(p.time), y: 270, 'text-anchor': 'middle' }, day.format(new Date(p.time)))));
  svg.append(deskShape('text', { x: 70, y: 24 }, 'Points of views missed that perfect hindsight served · lower is better'));
  for (const [key, label, color, dash] of keys) {
    let path = '';
    let previous = null;
    for (const p of deskSeries) {
      if (p.oracle === null || p[key] === null) { previous = null; continue; }
      path += `${previous !== null && p.time - previous === 3600000 ? 'L' : 'M'} ${x(p.time).toFixed(1)} ${y((p.oracle - p[key]) * 100).toFixed(1)} `;
      previous = p.time;
    }
    svg.append(deskShape('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-dasharray': dash }));
    const entry = node('li');
    const swatch = node('span', '—', 'series-swatch');
    swatch.style.color = color;
    swatch.setAttribute('aria-hidden', 'true');
    entry.append(swatch, document.createTextNode(`${label}${dash ? ' · dashed' : ' · solid'}`));
    legend.append(entry);
  }
}

function formatP(p) {
  if (p === null) return 'Not available';
  return p < 0.001 ? `${p.toExponential(1).replace('e', ' × 10^')}` : p.toFixed(3);
}

function renderDeskSignificance() {
  const metrics = deskResult?.value_metrics || {};
  const list = element('desk-significance');
  list.replaceChildren();
  const item = (title, value, note) => {
    const box = node('div', undefined, 'summary-item');
    box.append(node('dt', title), node('dd', value ?? 'Not available'), node('p', note));
    list.append(box);
  };
  const won = finiteOrNull(metrics.hours_won);
  const lost = finiteOrNull(metrics.hours_lost);
  const hours = finiteOrNull(metrics.hours);
  item('Hours won', won === null || hours === null ? null : `${won} of ${hours}`, lost === null ? '' : lost === 0 ? 'Never behind the standard rule' : `Behind the standard rule in ${lost}`);
  const p = finiteOrNull(metrics.sign_test_p);
  item('Sign test p-value', p === null ? null : formatP(p), p === null ? '' : p < 0.05 ? 'Win count very unlikely if the methods were equal' : 'Not significant at 5%');
  const low = finiteOrNull(metrics.paired_gain_ci_low_pts);
  const high = finiteOrNull(metrics.paired_gain_ci_high_pts);
  item('Paired gain, 95% interval', low === null || high === null ? null : `${deskPoints(low)} to ${deskPoints(high)}`, low !== null && low > 0 ? 'Interval excludes zero' : 'Interval includes zero');
  const misses = finiteOrNull(metrics.miss_reduction_pct);
  item('Fewer requests to the main servers', misses === null ? null : `${misses.toFixed(1)}%`, 'Share of the standard rule’s misses avoided');

  const gains = deskSeries.filter(pt => pt.xgboost !== null && pt.last_hour !== null).map(pt => (pt.xgboost - pt.last_hour) * 100).sort((a, b) => a - b);
  const svg = element('desk-hist');
  svg.replaceChildren();
  if (!gains.length) { element('desk-hist-note').textContent = 'Hourly gains not available.'; return; }
  const lowEdge = Math.min(0, Math.floor(gains[0] * 4) / 4);
  const highEdge = Math.max(0.25, Math.ceil(gains[gains.length - 1] * 4) / 4);
  const bins = Math.max(4, Math.min(24, Math.round((highEdge - lowEdge) / 0.25)));
  const width = (highEdge - lowEdge) / bins;
  const counts = Array(bins).fill(0);
  gains.forEach(g => { counts[Math.min(bins - 1, Math.floor((g - lowEdge) / width))]++; });
  const maxCount = Math.max(...counts);
  const x = value => 70 + (value - lowEdge) / (highEdge - lowEdge) * 660;
  const y = count => 210 - count / maxCount * 170;
  svg.append(deskShape('title', { id: 'desk-hist-title' }, 'Histogram of hourly gains in percentage points'),
    deskShape('desc', {}, `${gains.length} hours. Bars count hours by model minus standard rule hit rate. Bars right of zero are hours the model won.`));
  counts.forEach((count, i) => {
    const from = lowEdge + i * width;
    const bar = deskShape('rect', { x: x(from) + 1, y: y(count), width: Math.max(1, x(from + width) - x(from) - 2), height: 210 - y(count), fill: from + width <= 0 ? '#a2a9b1' : '#36c' });
    bar.append(deskShape('title', {}, `${deskPoints(from)} to ${deskPoints(from + width)} points: ${count} hour${count === 1 ? '' : 's'}`));
    svg.append(bar);
  });
  svg.append(deskShape('line', { x1: x(0), x2: x(0), y1: 30, y2: 214, stroke: '#202122', 'stroke-dasharray': '3 4' }),
    deskShape('text', { x: x(0), y: 24, 'text-anchor': 'middle' }, 'no difference'),
    deskShape('line', { x1: 70, x2: 730, y1: 210, y2: 210, stroke: '#a2a9b1' }));
  for (const tick of [lowEdge, (lowEdge + highEdge) / 2, highEdge, ...(lowEdge < 0 ? [0] : [])]) {
    svg.append(deskShape('text', { x: x(tick), y: 230, 'text-anchor': 'middle' }, deskPoints(tick)));
  }
  svg.append(deskShape('text', { x: 400, y: 252, 'text-anchor': 'middle' }, 'Model minus standard rule, percentage points per hour'));
  const median = gains.length % 2 ? gains[(gains.length - 1) / 2] : (gains[gains.length / 2 - 1] + gains[gains.length / 2]) / 2;
  element('desk-hist-note').textContent = `${gains.length} hours. Worst hour ${deskPoints(gains[0])}, median ${deskPoints(median)}, best ${deskPoints(gains[gains.length - 1])} points. Calculated here from the published hourly rates in hourly.csv; the published summary values are above.`;
}

async function renderDeskConfigs() {
  const body = element('desk-configs');
  body.replaceChildren();
  let results;
  try {
    results = await Promise.all(DESK_SIZES.flatMap(size => DESK_HORIZONS.map(h => getCompare(size, h))));
  } catch (error) {
    const row = node('tr');
    const cell = node('td', `Not available: ${error.message}`);
    cell.colSpan = 7;
    row.append(cell);
    body.append(row);
    return;
  }
  for (const result of results) {
    const m = result.value_metrics || {};
    const row = node('tr');
    row.dataset.config = `${result.cache_size}:${result.horizon}`;
    const show = (value, format) => value === null ? 'Not available' : format(value);
    const lost = finiteOrNull(m.hours_lost);
    const label = node('th', number.format(result.cache_size));
    label.scope = 'row';
    row.append(label, node('td', `${result.horizon} h`),
      node('td', show(finiteOrNull(m.miss_reduction_pct), v => `${v.toFixed(1)}%`)),
      node('td', show(finiteOrNull(m.hours_won), v => `${v} of ${finiteOrNull(m.hours) ?? '?'}${lost ? ` (lost ${lost})` : ''}`), lost ? 'desk-loss' : ''),
      node('td', show(finiteOrNull(m.sign_test_p), formatP)),
      node('td', `${show(rateOrNull(m.spike_hit_rate), v => percent.format(v))} / ${show(rateOrNull(m.standard_spike_hit_rate), v => percent.format(v))}`),
      node('td', `${show(finiteOrNull(m.catch_lag_h), v => `${v} h`)} / ${show(finiteOrNull(m.standard_catch_lag_h), v => `${v} h`)}`));
    row.addEventListener('click', () => { deskCapacity = result.cache_size; deskHorizon = result.horizon; refreshDesk(); });
    body.append(row);
  }
  highlightDeskConfig();
}

function highlightDeskConfig() {
  document.querySelectorAll('#desk-configs tr[data-config]').forEach(row => {
    row.classList.toggle('desk-current', row.dataset.config === `${deskCapacity}:${deskHorizon}`);
  });
}

document.getElementById('desk-play').addEventListener('click', toggleDesk);
document.getElementById('desk-previous').addEventListener('click', () => selectDeskHour(deskIndex - 1));
document.getElementById('desk-next').addEventListener('click', () => selectDeskHour(deskIndex + 1));
document.getElementById('desk-timeline').addEventListener('input', event => selectDeskHour(Number(event.target.value)));
document.querySelectorAll('[name="desk-capacity"],[name="desk-horizon"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked) return;
  if (input.name === 'desk-capacity') deskCapacity = Number(input.value);
  else deskHorizon = Number(input.value);
  refreshDesk();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseDesk(); });
