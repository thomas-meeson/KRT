'use strict';

// Consume teammate-owned output. Never infer performance from the top-50 sample.
const SOURCE = '../out/demo.json';
const FRAME_MS = 2000;
let replay = null;
let selectedIndex = 0;
let playbackTimer = null;
const element = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-GB');
const percent = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isRate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isHour = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace('Z', '.000Z');

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The replay file must contain a JSON object.');
  if (typeof data.day !== 'string' || !isHour(`${data.day}T00:00:00Z`)) throw new Error('The replay day is missing or invalid.');
  if (!Array.isArray(data.predictors) || !data.predictors.length || data.predictors.some(name => typeof name !== 'string' || !name.trim())
    || new Set(data.predictors).size !== data.predictors.length) throw new Error('The dataset needs unique, non-empty model names.');
  if (!Array.isArray(data.hours) || !data.hours.length) throw new Error('No replay hours have been supplied.');
  const hours = data.hours.filter(hour => hour && isHour(hour.hour) && hour.hour.slice(0, 10) === data.day).sort((a, b) => a.hour.localeCompare(b.hour));
  if (!hours.length) throw new Error('No valid UTC hours are available for the replay day.');
  if (new Set(hours.map(hour => hour.hour)).size !== hours.length) throw new Error('Duplicate replay hours need to be corrected in the source file.');
  return { hours, omitted: data.hours.length - hours.length };
}

function render() {
  const { data, hours, omitted } = replay;
  const hour = hours[selectedIndex];
  const warnings = [];
  if (omitted) warnings.push(`${omitted} invalid or out-of-day hour(s) omitted.`);
  element('provenance').textContent = data._fake === true ? 'DEMO DATA / SYNTHETIC' : 'DEVELOPMENT DATA / UNVERIFIED';
  element('hour').dateTime = hour.hour;
  element('hour').textContent = `${dateTime.format(new Date(hour.hour))} UTC`;
  element('interval').textContent = `${hour.hour.slice(11, 16)}–${hour.hour.slice(11, 13)}:59 UTC · hour ${selectedIndex + 1} of ${hours.length} available`;
  updateControls();
  element('capacity').textContent = isCount(data.cache_size) && data.cache_size > 0 ? `${number.format(data.cache_size)} articles` : 'Unavailable';
  element('total').textContent = isCount(hour.total_views) ? number.format(hour.total_views) : 'Unavailable';
  element('hour-count').textContent = `${hours.length} / 24`;
  if (!isCount(data.cache_size) || data.cache_size === 0 || !isCount(hour.total_views)) warnings.push('Some context values are unavailable.');
  const models = element('performance');
  models.replaceChildren();
  for (const name of data.predictors) {
    const value = hour.hit_rate?.[name];
    const valid = isRate(value);
    const card = node('section', undefined, 'model');
    const label = node('h3', modelLabel(data, name), 'model-label');
    label.append(node('span', name === 'last_hour' ? 'Previous-hour baseline · supplied hit rate' : 'Comparison model · supplied hit rate'));
    const rate = node('p', valid ? percent.format(value) : 'Unavailable', `rate${valid ? '' : ' unavailable'}`);
    card.append(label, rate);
    if (valid) {
      const meter = node('div', undefined, 'meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = node('div', undefined, 'meter-fill');
      fill.style.width = `${value * 100}%`;
      meter.append(fill);
      card.append(meter);
    } else warnings.push(`Hit rate unavailable for ${name}.`);
    models.append(card);
  }
  const heading = node('tr');
  for (const [title, className] of [['#', ''], ['Article', ''], ['Views', 'views'], ...data.predictors.map(name => [modelLabel(data, name), 'cache'])]) {
    const cell = node('th', title, className);
    cell.scope = 'col';
    heading.append(cell);
  }
  element('table-head').replaceChildren(heading);
  const suppliedPages = Array.isArray(hour.top_pages) ? hour.top_pages : [];
  const pages = suppliedPages.filter(page => page && typeof page.page === 'string' && page.page.trim() && isCount(page.views));
  const invalidPages = suppliedPages.length - pages.length;
  if (invalidPages) warnings.push(`${invalidPages} invalid article row(s) omitted.`);
  pages.sort((a, b) => b.views - a.views);
  element('page-count').textContent = `${pages.length} supplied articles · ordered by views`;
  const body = element('table-body');
  body.replaceChildren();
  let unknownCache = false;
  pages.forEach((page, index) => {
    const row = node('tr');
    const title = node('th', page.page.replaceAll('_', ' '));
    title.scope = 'row';
    row.append(node('td', String(index + 1).padStart(2, '0'), 'rank'), title, node('td', number.format(page.views), 'views'));
    for (const name of data.predictors) {
      const cached = page.cached?.[name];
      const known = typeof cached === 'boolean';
      unknownCache ||= !known;
      const cell = node('td', undefined, 'cache');
      cell.append(node('span', known ? (cached ? '✓ Cached' : '× Missed') : '— Unavailable', `badge${known ? (cached ? '' : ' missed') : ' unknown'}`));
      row.append(cell);
    }
    body.append(row);
  });
  if (unknownCache) warnings.push('Some article cache decisions are unavailable.');
  if (!pages.length) {
    const row = node('tr');
    const cell = node('td', 'No valid article rows were supplied for this hour.');
    cell.colSpan = 3 + data.predictors.length;
    row.append(cell);
    body.append(row);
  }
  element('status').textContent = warnings.length ? `Partial dataset: ${warnings.join(' ')}` : '';
  element('status').hidden = !warnings.length;
  element('replay').hidden = false;
}

function updateControls() {
  if (!replay) return;
  const { hours } = replay;
  const lastIndex = hours.length - 1;
  const playing = playbackTimer !== null;
  element('previous').disabled = selectedIndex === 0;
  element('next').disabled = selectedIndex === lastIndex;
  element('play').disabled = hours.length < 2;
  element('play').textContent = playing ? 'Pause' : selectedIndex === lastIndex && lastIndex > 0 ? 'Replay day' : 'Play';
  element('timeline').max = lastIndex;
  element('timeline').value = selectedIndex;
  element('timeline').disabled = hours.length < 2;
  element('timeline').setAttribute('aria-valuetext', `${dateTime.format(new Date(hours[selectedIndex].hour))} UTC, available hour ${selectedIndex + 1} of ${hours.length}`);
  element('timeline-start').textContent = `${hours[0].hour.slice(11, 16)} UTC`;
  element('timeline-end').textContent = `${hours[lastIndex].hour.slice(11, 16)} UTC`;
  element('playback-state').textContent = hours.length === 1 ? 'Only one hour available' : playing ? 'Playing · 2 seconds per available hour' : selectedIndex === lastIndex ? 'End of replay' : 'Paused · 2 seconds per available hour';
  const gaps = 24 - hours.length;
  element('coverage').textContent = gaps ? `${gaps} hour${gaps === 1 ? '' : 's'} unavailable in this UTC day. The timeline steps through supplied hours only; gaps are not interpolated.` : 'All 24 hourly records are available. Use arrow keys on the timeline to step through the day.';
}

function pause() {
  clearInterval(playbackTimer);
  playbackTimer = null;
  updateControls();
}

function selectHour(index) {
  if (!replay) return;
  pause();
  selectedIndex = Math.max(0, Math.min(replay.hours.length - 1, index));
  render();
  element('replay-announcement').textContent = `Selected ${dateTime.format(new Date(replay.hours[selectedIndex].hour))} UTC.`;
}

function togglePlayback() {
  if (!replay || replay.hours.length < 2) return;
  if (playbackTimer !== null) {
    pause();
    element('replay-announcement').textContent = `Paused at ${dateTime.format(new Date(replay.hours[selectedIndex].hour))} UTC.`;
    return;
  }
  if (selectedIndex === replay.hours.length - 1) selectedIndex = 0;
  playbackTimer = setInterval(() => {
    selectedIndex += 1;
    if (selectedIndex === replay.hours.length - 1) {
      pause();
      element('replay-announcement').textContent = 'End of replay. Playback paused.';
    }
    render();
  }, FRAME_MS);
  render();
  element('replay-announcement').textContent = 'Replay playing. Advances one available hour every two seconds.';
}

async function load() {
  pause();
  replay = null;
  selectedIndex = 0;
  element('replay').hidden = true;
  element('retry').hidden = true;
  element('status').hidden = false;
  element('status').className = 'status';
  element('status').textContent = 'Loading the supplied replay dataset…';
  element('provenance').textContent = 'DEVELOPMENT DATA / UNVERIFIED';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(SOURCE, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`The replay file could not be loaded (HTTP ${response.status}).`);
    let data;
    try { data = await response.json(); } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('The replay file is not valid JSON.');
    }
    replay = { data, ...validate(data) };
    renderPresentation(data);
    renderForesight(data);
    initializeSpikes(data);
    render();
  } catch (error) {
    element('status').className = 'status error';
    element('status').textContent = `${error.name === 'AbortError' ? 'Loading timed out.' : error.message} Serve the repository over HTTP and check out/demo.json. No substitute results have been generated.`;
    element('retry').hidden = false;
  } finally { clearTimeout(timeout); }
}

element('retry').addEventListener('click', load);
element('previous').addEventListener('click', () => selectHour(selectedIndex - 1));
element('next').addEventListener('click', () => selectHour(selectedIndex + 1));
element('timeline').addEventListener('input', event => selectHour(Number(event.target.value)));
element('play').addEventListener('click', togglePlayback);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playbackTimer !== null) {
    pause();
    element('replay-announcement').textContent = 'Replay paused while the page was hidden.';
  }
});
window.addEventListener('pagehide', pause);
load();
