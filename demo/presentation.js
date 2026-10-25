'use strict';

function renderPresentation(data) {
  const content = element('summary-values');
  content.replaceChildren();
  for (const key of data.predictors) {
    const value = data.summary?.hit_rate?.[key];
    const card = node('div', undefined, 'summary-item');
    card.append(node('dt', `${modelLabel(data, key)} · summary hit rate`),
      node('dd', isRate(value) ? percent.format(value) : 'Unavailable'));
    content.append(card);
  }
  const oracle = data.summary?.oracle_hit_rate;
  const card = node('div', undefined, 'summary-item oracle-item');
  card.append(node('dt', 'Oracle · hindsight ceiling'),
    node('dd', isRate(oracle) ? percent.format(oracle) : 'Unavailable'));
  content.append(card);
  element('summary-origin').textContent = data._fake === true ? 'DEMO DATA / SYNTHETIC' : 'DEVELOPMENT DATA / UNVERIFIED';
  element('oracle-note').textContent = isRate(oracle)
    ? 'Oracle: the supplied horizon-1 reference using actual future views to choose cache contents. It is a hindsight ceiling, not a deployable predictor.'
    : 'Oracle result unavailable in this file. Computing supplies summary.oracle_hit_rate; no ceiling has been estimated here.';
  const capacity = isCount(data.cache_size) && data.cache_size > 0 ? `${number.format(data.cache_size)} articles` : 'capacity unavailable';
  element('summary-scope').textContent = `Test-period summary · ${capacity} · 1-hour forecast horizon. These supplied averages are distinct from the selected hour below and do not change during replay.`;
}

document.getElementById('pitch-start').addEventListener('click', () => {
  if (!replay) return;
  selectHour(0);
  const target = element('summary-title');
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  target.focus({ preventScroll: true });
});

document.querySelectorAll('.pitch-nav a').forEach(link => {
  link.addEventListener('click', () => {
    pause();
    // Native anchors provide the URL and scroll behaviour; focus follows the story.
    const target = document.getElementById(link.hash.slice(1));
    if (target) target.focus({ preventScroll: true });
  });
});
