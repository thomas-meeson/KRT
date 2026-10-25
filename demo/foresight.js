'use strict';

// Display names never replace the keys used to look up supplied results.
function modelLabel(data, key) {
  if (key === 'last_hour') return 'Standard rule';
  if (key === 'our_model') return typeof data.our_model_name === 'string' && data.our_model_name.trim()
    ? `Our model (${data.our_model_name === 'xgboost' ? 'XGBoost' : data.our_model_name.trim()})` : 'Our model';
  return key.replaceAll('_', ' ');
}

function renderForesight(data) {
  renderHorizonLab(data);
  const horizons = [1, 2, 3, 6];
  const curve = data.summary?.foresight_curve;
  const supplied = curve?.horizons;
  const validHorizons = Array.isArray(supplied) && supplied.length > 0
    && supplied.every(h => horizons.includes(h)) && new Set(supplied).size === supplied.length;
  const series = data.predictors.map(key => {
    const values = curve?.hit_rate?.[key];
    // A length mismatch makes positional alignment uncertain: reject that series.
    const aligned = validHorizons && Array.isArray(values) && values.length === supplied.length;
    return { key, label: modelLabel(data, key), values: horizons.map(h => {
      const value = aligned ? values[supplied.indexOf(h)] : undefined;
      return isRate(value) ? value : null;
    }) };
  });
  const count = series.reduce((sum, model) => sum + model.values.filter(v => v !== null).length, 0);
  element('foresight-status').textContent = count === 0
    ? 'Foresight results unavailable. Waiting for valid summary values from Computing.'
    : count < series.length * horizons.length
      ? 'Partial results: unavailable values are left blank in the plot and marked in the table. Lines do not bridge missing horizons.'
      : 'Average hourly cache hit rates from the test period. These are measured outcomes, not predicted view counts.';
  element('foresight-coverage').textContent = approvedRun && data._fake !== true
    ? `Evaluated hours by horizon: ${horizons.map(h => `${h}h: ${approvedRun.hours_by_horizon[h]}`).join(' · ')}. Methods share the same hours within a horizon; coverage differs across horizons.`
    : 'Evaluation counts are not confirmed for this dataset.';

  const head = node('tr');
  ['How far ahead?', ...series.map(s => s.label)].forEach(label => {
    const cell = node('th', label);
    cell.scope = 'col';
    head.append(cell);
  });
  element('foresight-head').replaceChildren(head);
  const body = element('foresight-body');
  body.replaceChildren();
  horizons.forEach((h, index) => {
    const row = node('tr');
    const label = node('th', `${h} ${h === 1 ? 'hour' : 'hours'}`);
    label.scope = 'row';
    row.append(label);
    series.forEach(s => row.append(node('td', s.values[index] === null ? 'Unavailable' : percent.format(s.values[index]))));
    body.append(row);
  });

  const svg = element('foresight-chart');
  svg.replaceChildren();
  svg.style.display = count === 0 ? 'none' : '';
  const legend = element('foresight-legend');
  legend.replaceChildren();
  if (!count) return;
  const palette = ['#202122', '#3366cc', '#92502c', '#345fa1'];
  const dashes = ['', '8 5', '2 5', '10 4 2 4'];
  const x = h => 65 + (h - 1) / 5 * 640;
  // Zoom to padded five-point bounds; keep absolute rates and disclose the scale.
  const rates = series.flatMap(model => model.values.filter(value => value !== null));
  let lower = Math.max(0, Math.floor((Math.min(...rates) - .01) / .05) * .05);
  let upper = Math.min(1, Math.ceil((Math.max(...rates) + .01) / .05) * .05);
  if (upper - lower < .1) {
    lower = Math.max(0, Math.min(lower, upper - .1));
    upper = Math.min(1, Math.max(upper, lower + .1));
  }
  const y = rate => 265 - (rate - lower) / (upper - lower) * 220;
  element('foresight-status').textContent += ` Chart scale: ${percent.format(lower)} to ${percent.format(upper)}. The vertical axis is zoomed to make differences easier to see; it does not start at zero.`;
  function shape(tag, attrs = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  svg.append(shape('title', { id: 'foresight-chart-title' }, 'Cache hit rate by forecast horizon'),
    shape('desc', {}, `Zoomed hit-rate axis from ${percent.format(lower)} to ${percent.format(upper)} at one, two, three and six hours. Exact values and model names appear in the table below. Missing values are not interpolated.`));
  for (const rate of Array.from({length: 5}, (_, index) => lower + index * (upper - lower) / 4)) {
    svg.append(shape('line', { x1: 65, x2: 705, y1: y(rate), y2: y(rate), stroke: '#ccd2c9' }),
      shape('text', { x: 52, y: y(rate) + 4, 'text-anchor': 'end' }, percent.format(rate)));
  }
  horizons.forEach(h => svg.append(shape('text', { x: x(h), y: 288, 'text-anchor': 'middle' }, `${h}h`)));
  svg.append(shape('text', { x: 65, y: 22 }, 'Views served from fast storage · zoomed scale'), shape('text', { x: 385, y: 320, 'text-anchor': 'middle' }, 'How many hours before readers arrive?'));
  series.forEach((model, index) => {
    const color = palette[index % palette.length];
    const dash = dashes[index % dashes.length];
    const entry = node('li');
    const swatch = node('span', index % 2 ? '■' : '●', 'series-swatch');
    swatch.style.color = color;
    swatch.setAttribute('aria-hidden', 'true');
    entry.append(swatch, document.createTextNode(`${model.label} · ${dash ? 'dashed' : 'solid'}`));
    legend.append(entry);
    let path = '';
    let connected = false;
    model.values.forEach((value, i) => {
      if (value === null) { connected = false; return; }
      path += `${connected ? 'L' : 'M'} ${x(horizons[i])} ${y(value)} `;
      connected = true;
    });
    svg.append(shape('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-dasharray': dash, 'data-series': model.key }));
    model.values.forEach((value, i) => {
      if (value === null) return;
      const point = index % 2
        ? shape('rect', { x: x(horizons[i]) - 4, y: y(value) - 4, width: 8, height: 8, fill: color })
        : shape('circle', { cx: x(horizons[i]), cy: y(value), r: 4, fill: color });
      point.append(shape('title', {}, `${model.label}: ${percent.format(value)} at ${horizons[i]} hours`));
      svg.append(point);
    });
  });
  highlightHorizon();
}


let selectedHorizon = 1;
let horizonData = null;
function renderHorizonLab(data) {
  horizonData = data;
  if (apiAvailable) return renderExplorer();
  element('hourly-explorer').hidden = true;
  document.querySelectorAll('[name="cache-capacity"]').forEach(input => { input.disabled = true; input.checked = input.value === '100000'; });
  element('capacity-note').hidden = false;
  const profile = resultProfile(100000);
  const ready = Boolean(profile && data._fake !== true);
  document.querySelectorAll('[name="planning-horizon"]').forEach(input => {
    input.disabled = !ready;
    input.checked = Number(input.value) === selectedHorizon;
  });
  element('planning-wait').textContent = `Wait ${selectedHorizon} ${selectedHorizon === 1 ? 'hour' : 'hours'}`;
  const output = element('horizon-outcome');
  output.replaceChildren();
  if (!ready) {
    output.append(node('p', 'The interactive comparison is unavailable until the published results match the confirmed run.'));
    return;
  }
  const curve = profile.summary.foresight_curve;
  const position = curve.horizons.indexOf(selectedHorizon);
  const scores = node('div', undefined, 'horizon-scores');
  for (const key of ['last_hour', 'our_model']) {
    const rate = curve.hit_rate[key][position];
    const card = node('div', undefined, 'horizon-score');
    card.append(node('h3', modelLabel(data, key)), node('p', percent.format(rate), 'interactive-rate'), node('p', 'average hourly views served', 'metric-note'));
    const meter = node('div', undefined, 'interactive-meter');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', `${modelLabel(data, key)}, ${selectedHorizon} hours ahead`);
    meter.setAttribute('aria-valuemin','0');
    meter.setAttribute('aria-valuemax','100');
    meter.setAttribute('aria-valuenow',String(rate * 100));
    const fill = node('span');
    fill.style.width = `${rate * 100}%`;
    meter.append(fill);
    card.append(meter);
    scores.append(card);
  }
  output.append(scores);
  const paired = profile.paired_comparisons.find(item => item.horizon === selectedHorizon);
  const difference = paired ? paired.difference_pp : (curve.hit_rate.our_model[position] - curve.hit_rate.last_hour[position]) * 100;
  output.append(node('p', `${difference >= 0 ? '+' : ''}${difference.toFixed(2)} percentage points with our model`, 'horizon-difference'));
  const hours = approvedRun.hours_by_horizon[selectedHorizon];
  output.append(node('p', `Both methods choose ${selectedHorizon} ${selectedHorizon === 1 ? 'hour' : 'hours'} before demand arrives. Compared across the same ${hours} evaluated hours. ${paired ? 'Difference from the published paired comparison.' : 'Difference calculated from the published rounded average rates.'}`, 'metric-note'));
  highlightHorizon();
}
function highlightHorizon() {
  const svg = element('foresight-chart');
  svg.querySelector('[data-horizon-highlight]')?.remove();
  if (!resultProfile(100000) || horizonData?._fake === true || !svg.querySelector('path')) return;
  const marker = document.createElementNS('http://www.w3.org/2000/svg','line');
  const x = 65 + (selectedHorizon - 1) / 5 * 640;
  for (const [name,value] of Object.entries({x1:x,x2:x,y1:40,y2:270,stroke:'#72777d','stroke-dasharray':'3 5','data-horizon-highlight':selectedHorizon})) marker.setAttribute(name,String(value));
  svg.insertBefore(marker,svg.querySelector('path'));
}
document.querySelectorAll('[name="planning-horizon"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked || !horizonData) return;
  selectedHorizon = Number(input.value);
  renderHorizonLab(horizonData);
}));

// Decision explorer: published results for any capacity and horizon, served by api.py.
let selectedCapacity = 100000;
let explorerResults = null;
let explorerError = null;
let explorerToken = 0;
let hourlyPoints = [];
let hourlyCursor = -1;
const explorerHorizons = [1, 2, 3, 6];
const pointFormat = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

async function refreshExplorer() {
  if (!apiAvailable || !horizonData) return;
  const token = ++explorerToken;
  explorerError = null;
  renderExplorer();
  try {
    const all = await Promise.all(explorerHorizons.map(h => getCompare(selectedCapacity, h)));
    if (token !== explorerToken) return;
    explorerResults = Object.fromEntries(all.map(result => [result.horizon, result]));
    // Redraws the foresight curve and table for this capacity, then this explorer.
    renderForesight({ ...horizonData, cache_size: selectedCapacity, summary: { foresight_curve: {
      horizons: explorerHorizons,
      hit_rate: {
        last_hour: explorerHorizons.map(h => rateOrNull(explorerResults[h].methods?.last_hour?.hit_rate)),
        our_model: explorerHorizons.map(h => rateOrNull(explorerResults[h].methods?.xgboost?.hit_rate)),
      },
    } } });
  } catch (error) {
    if (token !== explorerToken) return;
    explorerError = error.message;
    renderExplorer();
  }
}

function renderExplorer() {
  document.querySelectorAll('[name="planning-horizon"],[name="cache-capacity"]').forEach(input => {
    input.disabled = false;
    input.checked = Number(input.value) === (input.name === 'cache-capacity' ? selectedCapacity : selectedHorizon);
  });
  element('capacity-note').hidden = true;
  element('planning-wait').textContent = `Wait ${selectedHorizon} ${selectedHorizon === 1 ? 'hour' : 'hours'}`;
  element('horizon-note').textContent = `These are published historical results, not a new simulation. Storage is fixed at ${number.format(selectedCapacity)} articles for both methods. Bars use a 0–100% scale.`;
  const output = element('horizon-outcome');
  output.replaceChildren();
  const result = explorerResults?.[selectedHorizon];
  if (explorerError || !result || result.cache_size !== selectedCapacity) {
    output.append(node('p', explorerError ? `Not available: ${explorerError}` : 'Loading published results…', 'metric-note'));
    element('hourly-explorer').hidden = true;
    return;
  }
  const methods = result.methods || {};
  const scores = node('div', undefined, 'horizon-scores explorer-scores');
  for (const [key, label, note] of [
    ['last_hour', 'Standard rule', 'Keeps the most popular articles from the latest observed hour'],
    ['xgboost', modelLabel(horizonData, 'our_model'), 'Forecasts demand for the future hour'],
    ['oracle', 'Perfect hindsight', 'Uses what actually happened. A ceiling, not a usable method'],
  ]) {
    const row = methods[key];
    const rate = rateOrNull(row?.hit_rate);
    const low = rateOrNull(row?.hit_rate_ci_low);
    const high = rateOrNull(row?.hit_rate_ci_high);
    const card = node('div', undefined, `horizon-score score-${key}`);
    card.append(node('h3', label), node('p', rate === null ? 'Not available' : percent.format(rate), 'interactive-rate'),
      node('p', low !== null && high !== null ? `95% interval ${percent.format(low)} to ${percent.format(high)}` : '95% interval not available', 'metric-note'));
    if (rate !== null) {
      const meter = node('div', undefined, 'interactive-meter');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', `${label}, ${number.format(selectedCapacity)} articles, ${selectedHorizon} hours ahead`);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(rate * 100));
      const fill = node('span');
      fill.style.width = `${rate * 100}%`;
      meter.append(fill);
      card.append(meter);
    }
    card.append(node('p', note, 'metric-note'));
    scores.append(card);
  }
  output.append(scores);

  const metrics = result.value_metrics || {};
  const stats = node('dl', undefined, 'summary-grid explorer-stats');
  function stat(title, value, note) {
    const item = node('div', undefined, 'summary-item');
    item.append(node('dt', title), node('dd', value ?? 'Not available'), node('p', note));
    stats.append(item);
  }
  const missReduction = finiteOrNull(metrics.miss_reduction_pct);
  stat('Fewer requests to the main servers', missReduction === null ? null : `${missReduction.toFixed(1)}%`,
    'Share of the standard rule’s cache misses that our model avoided');
  const won = finiteOrNull(metrics.hours_won);
  const evaluated = finiteOrNull(metrics.hours);
  const lost = finiteOrNull(metrics.hours_lost);
  stat('Test hours won', won === null || evaluated === null ? null : `${won} of ${evaluated}`,
    lost === null ? 'Hours where our model served a larger share of views' : lost === 0 ? 'Our model beat the standard rule in every evaluated hour' : `The standard rule was ahead in ${lost} hour${lost === 1 ? '' : 's'}`);
  const gain = finiteOrNull(metrics.gain_pts);
  const ciLow = finiteOrNull(metrics.paired_gain_ci_low_pts);
  const ciHigh = finiteOrNull(metrics.paired_gain_ci_high_pts);
  stat('Difference in hit rate', gain === null ? null : `${pointFormat(gain)} points`,
    ciLow !== null && ciHigh !== null ? `Paired 95% interval ${pointFormat(ciLow)} to ${pointFormat(ciHigh)} points` : 'Paired 95% interval not available');
  const gap = finiteOrNull(metrics.gap_closed_pct);
  stat('Gap to perfect hindsight closed', gap === null ? null : `${Math.round(gap)}%`, 'Share of the standard rule’s shortfall recovered by our model');
  output.append(stats);
  const hours = finiteOrNull(methods.xgboost?.n_hours);
  output.append(node('p', `Both methods choose ${selectedHorizon} ${selectedHorizon === 1 ? 'hour' : 'hours'} before demand arrives, with room for ${number.format(selectedCapacity)} articles${hours === null ? '' : `, across the same ${hours} evaluated hours`}. Cache hit rates measure views served, not prediction accuracy. Published values from results.csv and value_metrics.csv.`, 'metric-note'));
  drawHourly(result);
}

function drawHourly(result) {
  const wrap = element('hourly-explorer');
  const svg = element('hourly-chart');
  svg.replaceChildren();
  const keys = [
    ['oracle', 'Perfect hindsight', '#72777d', '2 5', 1.5],
    ['last_hour', 'Standard rule', '#202122', '7 4', 2],
    ['xgboost', modelLabel(horizonData, 'our_model'), '#36c', '', 2.5],
  ];
  hourlyPoints = (Array.isArray(result.series) ? result.series : [])
    .map(point => ({ hour: point.hour, time: Date.parse(point.hour), ...Object.fromEntries(keys.map(([key]) => [key, rateOrNull(point[key])])) }))
    .filter(point => Number.isFinite(point.time)).sort((a, b) => a.time - b.time);
  const rates = hourlyPoints.flatMap(point => keys.map(([key]) => point[key]).filter(value => value !== null));
  wrap.hidden = !rates.length;
  if (!rates.length) return;
  const start = hourlyPoints[0].time;
  const span = Math.max(hourlyPoints[hourlyPoints.length - 1].time - start, 3600000);
  const lower = Math.max(0, Math.floor((Math.min(...rates) - .005) * 100) / 100);
  const upper = Math.min(1, Math.ceil((Math.max(...rates) + .005) * 100) / 100);
  const x = time => 70 + (time - start) / span * 660;
  const y = rate => 250 - (rate - lower) / (upper - lower) * 210;
  const shape = (tag, attrs = {}, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const axisPercent = new Intl.NumberFormat('en-GB', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  svg.append(shape('title', { id: 'hourly-chart-title' }, `Hourly cache hit rates, ${number.format(result.cache_size)} articles, ${result.horizon} hours ahead`),
    shape('desc', {}, `One point per evaluated hour. Zoomed axis from ${axisPercent.format(lower)} to ${axisPercent.format(upper)}. Use the left and right arrow keys to read individual hours.`));
  for (let i = 0; i <= 4; i++) {
    const rate = lower + i * (upper - lower) / 4;
    svg.append(shape('line', { x1: 70, x2: 730, y1: y(rate), y2: y(rate), stroke: '#eaecf0' }),
      shape('text', { x: 60, y: y(rate) + 4, 'text-anchor': 'end' }, axisPercent.format(rate)));
  }
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  hourlyPoints.filter(point => point.hour.endsWith('T00:00:00Z')).forEach(point => {
    svg.append(shape('line', { x1: x(point.time), x2: x(point.time), y1: 40, y2: 254, stroke: '#c8ccd1', 'stroke-dasharray': '2 4' }),
      shape('text', { x: x(point.time), y: 272, 'text-anchor': 'middle' }, `${dayLabel.format(new Date(point.time))} 00:00`));
  });
  svg.append(shape('text', { x: 70, y: 24 }, 'Views served from fast storage, each evaluated hour · zoomed scale'),
    shape('text', { x: 400, y: 298, 'text-anchor': 'middle' }, 'Hour being served (UTC)'));
  const legend = element('hourly-legend');
  legend.replaceChildren();
  for (const [key, label, color, dash, width] of keys) {
    let path = '';
    let previous = null;
    for (const point of hourlyPoints) {
      if (point[key] === null) { previous = null; continue; }
      path += `${previous !== null && point.time - previous === 3600000 ? 'L' : 'M'} ${x(point.time).toFixed(1)} ${y(point[key]).toFixed(1)} `;
      previous = point.time;
    }
    svg.append(shape('path', { d: path, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': dash, 'data-series': key }));
    const entry = node('li');
    const swatch = node('span', '—', 'series-swatch');
    swatch.style.color = color;
    swatch.setAttribute('aria-hidden', 'true');
    entry.append(swatch, document.createTextNode(`${label}${dash ? ' · dashed' : ' · solid'}`));
    legend.append(entry);
  }
  svg.append(shape('line', { 'data-cursor': '', x1: 0, x2: 0, y1: 40, y2: 254, stroke: '#202122', visibility: 'hidden' }),
    shape('rect', { 'data-overlay': '', x: 70, y: 40, width: 660, height: 214, fill: 'transparent' }));
  element('hourly-summary').textContent = `${hourlyPoints.length} evaluated hours from ${dateTime.format(new Date(hourlyPoints[0].time))} to ${dateTime.format(new Date(hourlyPoints[hourlyPoints.length - 1].time))} UTC. Each point is one hour's published hit rate from hourly.csv. Move across the chart or use the arrow keys to read an hour.`;
  setHourlyCursor(-1);
  hourlyScale = { x, start, span };
}

let hourlyScale = null;
function setHourlyCursor(index) {
  hourlyCursor = index;
  const cursor = element('hourly-chart').querySelector('[data-cursor]');
  const readout = element('hourly-readout');
  const point = hourlyPoints[index];
  if (!point || !hourlyScale) {
    cursor?.setAttribute('visibility', 'hidden');
    readout.textContent = 'Select a point on the chart to see that hour.';
    return;
  }
  const at = hourlyScale.x(point.time);
  cursor.setAttribute('x1', at);
  cursor.setAttribute('x2', at);
  cursor.setAttribute('visibility', 'visible');
  const show = value => value === null ? 'Not available' : percent.format(value);
  const gap = point.xgboost !== null && point.last_hour !== null ? ` (${pointFormat((point.xgboost - point.last_hour) * 100)} points)` : '';
  readout.textContent = `${dateTime.format(new Date(point.time))} UTC · Standard rule ${show(point.last_hour)} · ${modelLabel(horizonData, 'our_model')} ${show(point.xgboost)}${gap} · Perfect hindsight ${show(point.oracle)}`;
}

document.getElementById('hourly-chart').addEventListener('pointermove', event => {
  if (!hourlyPoints.length || !hourlyScale) return;
  const box = event.currentTarget.getBoundingClientRect();
  const svgX = (event.clientX - box.left) / box.width * 760;
  const time = hourlyScale.start + (svgX - 70) / 660 * hourlyScale.span;
  let best = 0;
  hourlyPoints.forEach((point, i) => { if (Math.abs(point.time - time) < Math.abs(hourlyPoints[best].time - time)) best = i; });
  if (best !== hourlyCursor) setHourlyCursor(best);
});
document.getElementById('hourly-chart').addEventListener('keydown', event => {
  if (!hourlyPoints.length) return;
  const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const step = moves[event.key];
  const next = Number.isFinite(step) ? (hourlyCursor < 0 ? 0 : hourlyCursor + step) : step < 0 ? 0 : hourlyPoints.length - 1;
  setHourlyCursor(Math.max(0, Math.min(hourlyPoints.length - 1, next)));
});
document.querySelectorAll('[name="cache-capacity"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked) return;
  selectedCapacity = Number(input.value);
  refreshExplorer();
}));
