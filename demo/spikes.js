'use strict';

let spikeRecords = [];
let spikeData = null;

function initializeSpikes(data) {
  spikeData = data;
  const supplied = Array.isArray(data.spikes) ? data.spikes : [];
  spikeRecords = supplied.filter(record => record && typeof record.page === 'string' && record.page.trim()
    && isHour(record.spike_hour) && record.spike_hour.slice(0, 10) === data.day
    && Array.isArray(record.hours) && record.hours.length > 0
    && Array.isArray(record.views) && record.views.length === record.hours.length
    && record.hours.every(isHour) && new Set(record.hours).size === record.hours.length
    && record.hours.includes(record.spike_hour));
  const select = element('spike-select');
  select.replaceChildren();
  spikeRecords.forEach((record, index) => {
    const option = node('option', `${record.page.replaceAll('_', ' ')} · ${record.spike_hour.slice(11, 16)} UTC`);
    option.value = index;
    select.append(option);
  });
  select.disabled = spikeRecords.length === 0;
  element('spike-content').hidden = spikeRecords.length === 0;
  element('spike-origin').textContent = data._fake === true ? 'DEMO DATA / SYNTHETIC' : 'DEVELOPMENT DATA / UNVERIFIED';
  const omitted = supplied.length - spikeRecords.length;
  element('spike-status').textContent = !spikeRecords.length
    ? 'No usable spike records supplied. Replay and foresight results remain available.'
    : `${spikeRecords.length} supplied event records.${omitted ? ` ${omitted} malformed record(s) omitted.` : ''} Event classification is supplied by Computing; the 24-hour median cannot be verified from this short window.`;
  if (spikeRecords.length) renderSpike(0);
}

function renderSpike(index) {
  const record = spikeRecords[index];
  if (!record) return;
  const onset = Date.parse(record.spike_hour);
  const points = record.hours.map((hour, i) => ({ hour, time: Date.parse(hour), views: record.views[i] })).sort((a, b) => a.time - b.time);
  const atSpike = points.find(point => point.time === onset);
  const conforms = isCount(atSpike.views) && atSpike.views >= 1000;
  const warnings = [];
  if (!conforms) warnings.push('The supplied spike-hour count is unavailable or below the agreed 1,000-view minimum. Earlier-response comparisons are withheld for this record.');
  if (points.some(point => !isCount(point.views) || point.views === 0)) warnings.push('Zero or invalid counts are shown as gaps: zero may represent missing or out-of-range data.');
  element('spike-warning').textContent = warnings.join(' ');
  element('spike-warning').hidden = !warnings.length;
  element('spike-name').textContent = record.page.replaceAll('_', ' ');
  element('spike-time').textContent = `Supplied onset: ${dateTime.format(new Date(onset))} UTC`;
  const jumpIndex = replay.hours.findIndex(hour => hour.hour === record.spike_hour);
  element('spike-jump').disabled = jumpIndex < 0;
  element('spike-jump').textContent = jumpIndex < 0 ? 'Event hour unavailable in replay' : 'Show event hour in replay';

  const isLag = lag => Number.isInteger(lag) && lag >= 0 && lag <= 24;
  const lags = spikeData.predictors.map(key => ({ key, label: modelLabel(spikeData, key), lag: record.catch_lag_h?.[key] }));
  const cards = element('spike-lags');
  cards.replaceChildren();
  lags.forEach(model => {
    const card = node('div', undefined, 'catch-card');
    card.append(node('dt', model.label));
    card.append(node('dd', !isLag(model.lag) ? 'Unavailable' : model.lag === 24 ? '24h / capped' : model.lag === 0 ? 'At spike arrival' : `${model.lag}h after arrival`));
    cards.append(card);
  });
  const baseline = lags.find(model => model.key === 'last_hour');
  const comparison = lags.find(model => model.key === 'our_model');
  let description = 'Catch lags are supplied results; 0h means cached at arrival. A 24h value is capped and may mean the page was never caught within the evaluation window.';
  if (conforms && baseline && comparison && [baseline.lag, comparison.lag].every(lag => isLag(lag) && lag < 24)) {
    const delta = baseline.lag - comparison.lag;
    description = delta === 0 ? 'Both methods have the same supplied catch lag.'
      : `${delta > 0 ? comparison.label : baseline.label} responded ${Math.abs(delta)} hour${Math.abs(delta) === 1 ? '' : 's'} earlier in this supplied record.`;
    description += ' This does not establish prediction before arrival or general model superiority.';
  }
  element('spike-comparison').textContent = description;

  const body = element('spike-values');
  body.replaceChildren();
  points.forEach(point => {
    const row = node('tr');
    const label = node('th', `${dateTime.format(new Date(point.time))} UTC${point.time === onset ? ' · onset' : ''}`);
    label.scope = 'row';
    row.append(label, node('td', !isCount(point.views) ? 'Unavailable' : point.views === 0 ? '0 supplied · observation uncertain' : number.format(point.views)));
    body.append(row);
  });
  drawSpike(points, onset, lags, isLag);
}

function drawSpike(points, onset, lags, isLag) {
  const svg = element('spike-chart');
  svg.replaceChildren();
  const start = points[0].time;
  const end = points[points.length - 1].time;
  const span = Math.max(end - start, 3600000);
  const max = Math.max(1, ...points.filter(p => isCount(p.views) && p.views > 0).map(p => p.views));
  const ceiling = Math.ceil(max / 4) * 4;
  const x = time => 80 + (time - start) / span * 610;
  const y = views => 240 - views / ceiling * 185;
  const height = 350 + lags.length * 30;
  svg.setAttribute('viewBox', `0 0 760 ${height}`);
  function shape(tag, attrs = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  svg.append(shape('title', { id: 'spike-chart-title' }, 'Supplied article views and reported catch times'),
    shape('desc', {}, 'The trajectory shows supplied hourly counts. Gaps represent uncertain observations. Separate labelled lanes mark reported catch times within this window. Exact counts and catch lags are available below.'));
  for (const fraction of [0, .5, 1]) {
    svg.append(shape('line', { x1: 80, x2: 690, y1: y(ceiling * fraction), y2: y(ceiling * fraction), stroke: '#ccd2c9' }),
      shape('text', { x: 68, y: y(ceiling * fraction) + 4, 'text-anchor': 'end' }, number.format(ceiling * fraction)));
  }
  svg.append(shape('text', { x: 80, y: 22 }, 'Views per supplied hour'),
    shape('line', { x1: x(onset), x2: x(onset), y1: 35, y2: 250, stroke: '#92502c', 'stroke-dasharray': '3 4' }),
    shape('text', { x: x(onset), y: 38, 'text-anchor': 'middle' }, 'Spike onset'));
  let path = '';
  let previous = null;
  points.forEach(point => {
    if (!isCount(point.views) || point.views === 0) { previous = null; return; }
    const connected = previous !== null && point.time - previous === 3600000;
    path += `${connected ? 'L' : 'M'} ${x(point.time)} ${y(point.views)} `;
    previous = point.time;
    const circle = shape('circle', { cx: x(point.time), cy: y(point.views), r: 4, fill: '#172a29' });
    circle.append(shape('title', {}, `${dateTime.format(new Date(point.time))} UTC: ${number.format(point.views)} views`));
    svg.append(circle);
  });
  svg.append(shape('path', { d: path, fill: 'none', stroke: '#172a29', 'stroke-width': 2.5, 'data-spike-trajectory': '' }));
  // Limit ticks while retaining real elapsed-hour spacing.
  points.filter((point, i) => i === 0 || i === points.length - 1 || point.time === onset || i % Math.ceil(points.length / 6) === 0)
    .forEach(point => svg.append(shape('text', { x: x(point.time), y: 266, 'text-anchor': 'middle' }, point.hour.slice(11, 16))));
  svg.append(shape('text', { x: 385, y: 290, 'text-anchor': 'middle' }, 'UTC · exact dates in the values table'));
  lags.forEach((model, i) => {
    const laneY = 330 + i * 30;
    const catchTime = onset + model.lag * 3600000;
    const color = i % 2 ? '#146348' : '#172a29';
    const label = model.label.length > 28 ? `${model.label.slice(0, 27)}…` : model.label;
    svg.append(shape('text', { x: 80, y: laneY - 10 }, label),
      shape('line', { x1: 80, x2: 690, y1: laneY, y2: laneY, stroke: '#ccd2c9' }));
    if (isLag(model.lag) && model.lag < 24 && catchTime >= start && catchTime <= end) {
      const marker = shape('rect', { x: x(catchTime) - 4, y: laneY - 4, width: 8, height: 8, fill: color });
      marker.append(shape('title', {}, `${model.label}: ${model.lag} hours after onset`));
      svg.append(marker);
    } else svg.append(shape('text', { x: 690, y: laneY - 10, 'text-anchor': 'end' }, !isLag(model.lag) ? 'Unavailable' : model.lag === 24 ? '24h / capped' : 'Catch outside plotted window'));
  });
}

document.getElementById('spike-select').addEventListener('change', event => renderSpike(Number(event.target.value)));
document.getElementById('spike-jump').addEventListener('click', () => {
  const record = spikeRecords[Number(element('spike-select').value)];
  if (!record || !replay) return;
  const index = replay.hours.findIndex(hour => hour.hour === record.spike_hour);
  if (index < 0) return;
  selectHour(index);
  element('snapshot-title').scrollIntoView({ block: 'start', behavior: 'instant' });
  element('timeline').focus({ preventScroll: true });
});
