'use strict';

// The FastAPI server (api.py) adds the decision explorer and article lookup.
// Served as plain static files, the published-data demo keeps working without them.
let apiAvailable = false;
const compareRequests = new Map();

async function apiGet(path, signal) {
  const response = await fetch(`../api/${path}`, { cache: 'no-store', signal: signal || AbortSignal.timeout(10000) });
  let body = null;
  try { body = await response.json(); } catch { /* Non-JSON means the API is not serving this path. */ }
  if (!response.ok || body === null) {
    const error = new Error(typeof body?.detail === 'string' ? body.detail : `The API request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function detectApi(signal) {
  try {
    const hours = await apiGet('hours', signal);
    apiAvailable = Array.isArray(hours?.hours);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    apiAvailable = false;
  }
  return apiAvailable;
}

// Published results never change while the page is open, so each comparison is fetched once.
function getCompare(cacheSize, horizon) {
  const key = `${cacheSize}:${horizon}`;
  if (!compareRequests.has(key)) {
    compareRequests.set(key, apiGet(`compare?cache_size=${cacheSize}&horizon=${horizon}`).catch(error => {
      compareRequests.delete(key);
      throw error;
    }));
  }
  return compareRequests.get(key);
}

const finiteOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rateOrNull = value => isRate(value) ? value : null;
