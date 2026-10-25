# Key numbers (test period: 72 hours the models never saw)

## Cache with room for 10,000 pages, deciding 1 hour ahead
- Perfect foresight (ceiling): **41.66%** of views served from cache (95% interval 41.32%–42.05%)
- XGBoost + decay feature: **40.57%** of views served from cache (95% interval 40.28%–40.90%)
- Last hour (standard rule): **40.47%** of views served from cache (95% interval 40.17%–40.81%)
- Physics: decay model: **39.72%** of views served from cache (95% interval 39.45%–40.03%)
- 24-hour average: **39.12%** of views served from cache (95% interval 38.89%–39.38%)
- Same hour yesterday: **36.66%** of views served from cache (95% interval 36.43%–36.93%)
- The standard rule leaves **1.19 points** on the table vs perfect foresight.

## Share of that gap each model recovers (1 hour ahead)
- 1,000 pages: Physics: decay model **-97%**, XGBoost + decay feature **-3%**
- 10,000 pages: Physics: decay model **-63%**, XGBoost + decay feature **+8%**
- 100,000 pages: Physics: decay model **+12%**, XGBoost + decay feature **+29%**

## Foresight (room for 10,000 pages): hit-rate points above the standard rule
- 1 h ahead: Physics: decay model -0.75, XGBoost + decay feature +0.10, Perfect foresight (ceiling) +1.19
- 2 h ahead: Physics: decay model -0.55, XGBoost + decay feature +0.21, Perfect foresight (ceiling) +1.95
- 3 h ahead: Physics: decay model -0.22, XGBoost + decay feature +0.44, Perfect foresight (ceiling) +2.66
- 6 h ahead: Physics: decay model +0.51, XGBoost + decay feature +1.22, Perfect foresight (ceiling) +4.19

## Spikes
- Median hours late catching a spike: Perfect foresight (ceiling) 0 h, XGBoost + decay feature 0 h, Last hour (standard rule) 0 h, Physics: decay model 0 h, 24-hour average 1 h, Same hour yesterday 14 h
- Example: **Tom Skerritt** peaked at 97,628 views/hour; the standard rule had it cached 0 h after the spike, XGBoost + decay feature after 0 h.

## Physics of attention
- After a spike, extra attention fades like a **power law** (alpha = 0.59, tau = 0.02 h), fitted on 471 spikes from the training days.
- **Half-life of attention: 0.1 hours** after the peak.
