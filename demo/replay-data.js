'use strict';

// Read already-scored hourly outputs. No cache selection or backtest runs here.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV field.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The replay can show 100,000 space hourly scores, or the replay file's own capacity,
// whose hit rates and per-article cache flags are supplied directly in demo.json.
let replayCapacity = 100000;
function applyReplayCapacity() {
  const supplied = replay.data.cache_size;
  const useSupplied = replayCapacity === supplied && isCount(supplied);
  replay.capacity = useSupplied ? supplied : 100000;
  replay.hasCacheChoices = replay.capacity === supplied;
  replay.hours = useSupplied ? replay.suppliedHours : replay.mainHours;
  document.querySelectorAll('[name="replay-capacity"]').forEach(input => {
    input.checked = Number(input.value) === replay.capacity;
    if (Number(input.value) !== 100000) input.disabled = Number(input.value) !== supplied;
  });
}

function configureExploreReplay() {
  replay.suppliedHours = replay.hours;
  replay.mainHours = buildMainHours(replay.hours);
  applyReplayCapacity();
}

function buildMainHours(demandHours) {
  if (replay.data.cache_size === 100000) return demandHours;
  // Demand is independent of cache size; only the capacity-specific scores change.
  const empty = demandHours.map(hour => ({ ...hour, hit_rate: {} }));
  if (!approvedRun || replay.data._fake === true || !confirmedHourlyText) return empty;
  try {
    const rows = csvRows(confirmedHourlyText);
    const headings = rows.shift() || [];
    const fields = Object.fromEntries(['predictor','cache_size','horizon','target_hour','hit_rate'].map(name => [name, headings.indexOf(name)]));
    if (Object.values(fields).some(index => index < 0)) throw new Error('Missing hourly fields.');
    const expected = new Map(replay.data.predictors.map(key => [key === 'our_model' ? replay.data.our_model_name : key, key]));
    const rates = new Map();
    for (const row of rows) {
      if (row[fields.cache_size] !== '100000' || row[fields.horizon] !== '1' || !expected.has(row[fields.predictor])) continue;
      const time = `${row[fields.target_hour]?.replace(' ', 'T')}Z`;
      const supplied = row[fields.hit_rate];
      const value = supplied?.trim() ? Number(supplied) : NaN;
      if (!isHour(time) || !isRate(value)) continue;
      const key = expected.get(row[fields.predictor]);
      if (!rates.has(time)) rates.set(time, {});
      if (Object.hasOwn(rates.get(time), key)) throw new Error('Duplicate hourly result.');
      rates.get(time)[key] = value;
    }
    return demandHours.map(hour => ({ ...hour, hit_rate: rates.get(hour.hour) || {} }));
  } catch {
    // Keep demand visible but never substitute the 10k cache results.
    return empty;
  }
}

document.querySelectorAll('[name="replay-capacity"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked || !replay) return;
  replayCapacity = Number(input.value);
  pause();
  applyReplayCapacity();
  render();
  element('replay-announcement').textContent = `Showing the replay with space for ${number.format(replay.capacity)} articles.`;
}));
