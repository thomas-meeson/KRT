'use strict';

// Display names never replace the keys used to look up supplied results.
function modelLabel(data, key) {
  return key === 'our_model' && typeof data.our_model_name === 'string' && data.our_model_name.trim()
    ? data.our_model_name.trim() : key;
}

function renderForesight(data) {
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
      : 'Supplied summary results · independent of the selected replay hour.';
  element('foresight-origin').textContent = data._fake === true ? 'DEMO DATA / SYNTHETIC' : 'DEVELOPMENT DATA / UNVERIFIED';

  const head = node('tr');
  ['Forecast horizon', ...series.map(s => s.label)].forEach(label => {
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
  const palette = ['#172a29', '#146348', '#92502c', '#345fa1'];
  const dashes = ['', '8 5', '2 5', '10 4 2 4'];
  const x = h => 65 + (h - 1) / 5 * 640;
  const y = rate => 265 - rate * 220;
  function shape(tag, attrs = {}, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  svg.append(shape('title', { id: 'foresight-chart-title' }, 'Cache hit rate by forecast horizon'),
    shape('desc', {}, 'Hit rates from zero to one hundred percent at one, two, three and six hours. Exact values and model names appear in the table below. Missing values are not interpolated.'));
  for (const rate of [0, .25, .5, .75, 1]) {
    svg.append(shape('line', { x1: 65, x2: 705, y1: y(rate), y2: y(rate), stroke: '#ccd2c9' }),
      shape('text', { x: 52, y: y(rate) + 4, 'text-anchor': 'end' }, percent.format(rate)));
  }
  horizons.forEach(h => svg.append(shape('text', { x: x(h), y: 288, 'text-anchor': 'middle' }, `${h}h`)));
  svg.append(shape('text', { x: 65, y: 22 }, 'Cache hit rate'), shape('text', { x: 385, y: 320, 'text-anchor': 'middle' }, 'Forecast horizon (hours ahead)'));
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
}
