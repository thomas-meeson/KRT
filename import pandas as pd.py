import pandas as pd
df = pd.read_parquet("data/views.parquet")
import numpy as np

ALPHA = 1.0  # placeholder; fit from real spikes after 02:30

def predict(history, now, horizon=1):
    start = now - pd.Timedelta(hours=23)
    recent = history[history.hour >= start] # filters out last 24 hours
    # candidate set: keep it tractable on real data
    top = recent.groupby("page").views.sum().nlargest(200_000).index
    recent = recent[recent.page.isin(top)] # takes the top 200k pages by views in the last 24 hours

    hours = pd.date_range(start, now, freq="h") # creates a range of hourly timestamps from start to now
    wide = (recent.pivot_table(index="page", columns="hour", values="views", fill_value=0) # creates a wide-format DataFrame with pages as rows and hours as columns
                  .reindex(columns=hours, fill_value=0))  # missing hours = 0

    last = wide.iloc[:, -1] # the last column of the wide DataFrame, which represents the most recent hour's views for each page
    base = wide.median(axis=1) # the median views for each page across the last 24 hours
    t = 23 - wide.values.argmax(axis=1)  # hours since peak
    excess = (last - base).clip(lower=0) # difference between last hour and median floored at 0
    factor = ((t + 1 + horizon) / (t + 1)) ** (-ALPHA) # the decay factor based on how many hours have passed since the peak, adjusted for the prediction horizon
    return (base + excess * factor).clip(lower=0) # this tells us that if the last hour's views are above the median, we will decay that excess based on how long ago the peak was, 
    #and add it to the base median to get our prediction for the next hour. The result is floored at 0 to avoid negative predictions.