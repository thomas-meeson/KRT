"""Registry of predictors. backtest.py runs everything listed in PREDICTORS.

To add a model: write predict(history, now, horizon=1) -> pd.Series in its own file
(see INTERFACES.md section 2), import it here, and add one line to PREDICTORS.
"""
from .baselines import last_24h_mean, last_hour, same_hour_yesterday
from .decay_predict import predict as decay_predict
from .decay_predict import predict as decay_predict

PREDICTORS = {
    "last_hour": last_hour,                       # standard rule, ~ "least recently used"
    "last_24h_mean": last_24h_mean,               # ~ "least frequently used"
    "same_hour_yesterday": same_hour_yesterday,   # daily rhythm
    # "xgboost": xgb_predict,                     # Computing
    "decay": decay_predict,                       # Physics
    # "transformer": transformer_predict,         # Computing
}
