'use strict';

// Article lookup: only pages present in demo.json, via /api/pages and /api/page/{title}.
const UNAVAILABLE_ARTICLE = 'This article is not available in the recorded demo dataset.';
let articleToken = 0;
let searchToken = 0;

async function openArticle(title, { reveal = false } = {}) {
  const token = ++articleToken;
  if (reveal) showView('explore', { focus: false });
  element('article-lookup').hidden = false;
  element('article-name').textContent = title.replaceAll('_', ' ');
  element('article-content').hidden = true;
  element('article-status').textContent = apiAvailable ? 'Loading recorded observations…' : 'Article lookup needs the local API server (uvicorn api:app).';
  if (reveal) element('article-lookup').scrollIntoView({ behavior: 'instant', block: 'start' });
  if (!apiAvailable) return;
  try {
    const article = await apiGet(`page/${encodeURIComponent(title)}`);
    if (token !== articleToken) return;
    renderArticle(article);
  } catch (error) {
    if (token !== articleToken) return;
    element('article-status').textContent = error.status === 404 ? UNAVAILABLE_ARTICLE : `Not available: ${error.message}`;
  }
  if (reveal) element('article-name').focus({ preventScroll: true });
}

function renderArticle(article) {
  const observations = Array.isArray(article.observations) ? article.observations.filter(item => isHour(item?.hour)) : [];
  const keys = Array.isArray(replay?.data.predictors) ? replay.data.predictors : ['last_hour', 'our_model'];
  element('article-name').textContent = article.page.replaceAll('_', ' ');
  const recorded = observations.filter(item => isCount(item.views));
  const peak = recorded.reduce((best, item) => (!best || item.views > best.views ? item : best), null);
  const cachedHours = Object.fromEntries(keys.map(key => [key, observations.filter(item => item.cached?.[key] === true).length]));
  const listedHours = observations.filter(item => item.source === 'top_pages').length;
  const capacity = isCount(article.cache_size) ? number.format(article.cache_size) : 'the replay';
  element('article-status').textContent = '';
  element('article-summary').textContent = recorded.length
    ? `Recorded views in ${recorded.length} of ${observations.length} hours on ${article.day}. Peak: ${number.format(peak.views)} views in the hour starting ${peak.hour.slice(11, 16)} UTC.`
    : `No recorded view counts for this article on ${article.day}.`;
  element('article-scope').textContent = `Cache choices come from the replay file's ${capacity} article caches, chosen one hour ahead, and are only recorded for hours when the article was in the top 50 (${listedHours} hour${listedHours === 1 ? '' : 's'}). ${keys.map(key => `${modelLabel(replay?.data || {}, key)} had it stored in ${cachedHours[key]} of them`).join('; ')}. Other hours are shown as unavailable, not as zero.`;

  const spikeNode = element('article-spike');
  spikeNode.replaceChildren();
  const spikes = Array.isArray(article.spikes) ? article.spikes.filter(spike => isHour(spike?.spike_hour)) : [];
  if (spikes.length) {
    const spike = spikes[0];
    spikeNode.append(node('strong', 'Recorded surge. '), document.createTextNode(`The team's spike records mark an onset at ${spike.spike_hour.slice(11, 16)} UTC. This shows recorded attention, not an early prediction. `));
    const index = spikeRecords.findIndex(record => record.page === spike.page && record.spike_hour === spike.spike_hour);
    if (index >= 0) {
      const button = node('button', 'See its spike story', 'text-button');
      button.type = 'button';
      button.addEventListener('click', () => {
        element('spike-select').value = String(index);
        renderSpike(index);
        showView('results', { focus: false });
        element('spike-details').open = true;
        element('spike-title').scrollIntoView({ behavior: 'instant', block: 'start' });
        element('spike-title').focus({ preventScroll: true });
      });
      spikeNode.append(button);
    }
  }
  spikeNode.hidden = !spikes.length;

  const head = node('tr');
  ['Hour (UTC)', 'Views', ...keys.map(key => modelLabel(replay?.data || {}, key))].forEach(label => {
    const cell = node('th', label);
    cell.scope = 'col';
    head.append(cell);
  });
  element('article-head').replaceChildren(head);
  const body = element('article-values');
  body.replaceChildren();
  for (const item of observations) {
    const row = node('tr');
    const label = node('th');
    label.scope = 'row';
    const replayIndex = replay ? replay.hours.findIndex(hour => hour.hour === item.hour) : -1;
    if (replayIndex >= 0) {
      const jump = node('button', `${item.hour.slice(11, 16)} UTC`, 'text-button hour-link');
      jump.type = 'button';
      jump.setAttribute('aria-label', `Show ${item.hour.slice(11, 16)} UTC in the replay`);
      jump.addEventListener('click', () => {
        selectHour(replayIndex);
        element('snapshot-title').scrollIntoView({ behavior: 'instant', block: 'start' });
        element('timeline').focus({ preventScroll: true });
      });
      label.append(jump);
    } else label.textContent = `${item.hour.slice(11, 16)} UTC`;
    const views = isCount(item.views) ? `${number.format(item.views)}${item.source === 'spike' ? ' (spike record)' : ''}` : 'Unavailable';
    row.append(label, node('td', views, 'views'));
    for (const key of keys) {
      const cached = item.cached?.[key];
      const cell = node('td', undefined, 'cache');
      cell.append(node('span', cached === true ? '✓ Ready' : cached === false ? '× Not ready' : 'Not recorded', `badge${cached === true ? '' : cached === false ? ' missed' : ' unknown'}`));
      row.append(cell);
    }
    body.append(row);
  }
  drawArticle(observations, spikes[0]?.spike_hour);
  element('article-content').hidden = false;
}

function drawArticle(observations, onsetHour) {
  const svg = element('article-chart');
  svg.replaceChildren();
  const points = observations.map(item => ({ hour: item.hour, time: Date.parse(item.hour), views: isCount(item.views) ? item.views : null }));
  const known = points.filter(point => point.views !== null);
  svg.style.display = known.length ? '' : 'none';
  if (!known.length) return;
  const start = points[0].time;
  const span = Math.max(points[points.length - 1].time - start, 3600000);
  const ceiling = Math.max(4, Math.ceil(Math.max(...known.map(point => point.views)) / 4) * 4);
  const x = time => 80 + (time - start) / span * 640;
  const y = views => 200 - views / ceiling * 160;
  const shape = (tag, attrs = {}, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  svg.append(shape('title', { id: 'article-chart-title' }, 'Recorded hourly views for this article'),
    shape('desc', {}, 'Actual views only. Hours without a recorded count are left as gaps. Exact values are in the table below.'));
  for (const fraction of [0, .5, 1]) {
    svg.append(shape('line', { x1: 80, x2: 720, y1: y(ceiling * fraction), y2: y(ceiling * fraction), stroke: '#eaecf0' }),
      shape('text', { x: 68, y: y(ceiling * fraction) + 4, 'text-anchor': 'end' }, number.format(ceiling * fraction)));
  }
  if (onsetHour) {
    const onset = Date.parse(onsetHour);
    svg.append(shape('line', { x1: x(onset), x2: x(onset), y1: 30, y2: 205, stroke: '#92502c', 'stroke-dasharray': '3 4' }),
      shape('text', { x: x(onset), y: 24, 'text-anchor': 'middle' }, 'Spike onset'));
  }
  let path = '';
  let previous = null;
  for (const point of points) {
    if (point.views === null) { previous = null; continue; }
    path += `${previous !== null && point.time - previous === 3600000 ? 'L' : 'M'} ${x(point.time)} ${y(point.views)} `;
    previous = point.time;
    const dot = shape('circle', { cx: x(point.time), cy: y(point.views), r: 3.5, fill: '#202122' });
    dot.append(shape('title', {}, `${point.hour.slice(11, 16)} UTC: ${number.format(point.views)} views`));
    svg.append(dot);
  }
  svg.append(shape('path', { d: path, fill: 'none', stroke: '#202122', 'stroke-width': 2 }));
  points.filter((_, i) => i % 3 === 0).forEach(point => svg.append(shape('text', { x: x(point.time), y: 224, 'text-anchor': 'middle' }, point.hour.slice(11, 16))));
  svg.append(shape('text', { x: 400, y: 248, 'text-anchor': 'middle' }, 'UTC hour'));
}

// Header search: matching sections come first, then recorded articles from the API.
async function appendArticleMatches(query, list, sectionMatches, { openExact = false } = {}) {
  const token = ++searchToken;
  const noMatch = () => { if (!sectionMatches && token === searchToken) element('search-message').textContent = 'No matching sections. Try cache, model, storage or an article name.'; };
  if (!apiAvailable || query.length < 2) return noMatch();
  let pages;
  try { ({ pages } = await apiGet(`pages?q=${encodeURIComponent(query)}`)); } catch { return noMatch(); }
  if (token !== searchToken || !Array.isArray(pages)) return;
  const normalised = query.replaceAll(' ', '_').toLocaleLowerCase();
  const exact = pages.find(page => page.toLocaleLowerCase() === normalised);
  if (openExact && exact) {
    element('search-results').hidden = true;
    openArticle(exact, { reveal: true });
    return;
  }
  list.append(node('li', pages.length ? `Articles recorded on ${replay?.data.day || 'the replay day'}` : UNAVAILABLE_ARTICLE, 'search-group'));
  for (const page of pages.slice(0, 8)) {
    const item = node('li');
    const button = node('button', page.replaceAll('_', ' '), 'search-article');
    button.type = 'button';
    button.addEventListener('click', () => {
      element('search-results').hidden = true;
      openArticle(page, { reveal: true });
    });
    item.append(button);
    list.append(item);
  }
  if (!sectionMatches) element('search-message').textContent = pages.length ? 'Matching articles in the recorded demo dataset' : 'No matching sections or recorded articles.';
}

document.getElementById('article-close').addEventListener('click', () => {
  articleToken++;
  element('article-lookup').hidden = true;
  element('leaderboard-title').focus?.();
});
