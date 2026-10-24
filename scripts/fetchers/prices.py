"""Daily open/high/low/close/volume for every ticker in config.json.

Free tier returns the last 100 trading days; each run merges into what is
already saved, so history keeps growing.

Output (data/prices.json):
    {"updated", "failures": [...], "series": {SYMBOL: {"YYYY-MM-DD": {o,h,l,c,v}}}}
"""
from av_client import BudgetExceeded


def parse(payload: dict) -> dict:
    series = payload.get("Time Series (Daily)")
    if not series:
        raise ValueError(f"no daily series in answer (keys: {', '.join(payload)})")
    return {
        day: {
            "o": float(b["1. open"]),
            "h": float(b["2. high"]),
            "l": float(b["3. low"]),
            "c": float(b["4. close"]),
            "v": int(float(b["5. volume"])),
        }
        for day, b in series.items()
    }


def run(config, client, previous):
    series = (previous or {}).get("series", {})
    failures = []
    for t in config["tickers"]:
        sym = t["symbol"]
        try:
            bars = parse(client.get("TIME_SERIES_DAILY", symbol=sym, outputsize="compact"))
        except BudgetExceeded as e:
            failures.append(f"{sym}: {e}")
            continue
        except Exception as e:  # keep going; old data stays in place
            failures.append(f"{sym}: {e}")
            continue
        series[sym] = dict(sorted({**series.get(sym, {}), **bars}.items()))
        print(f"  prices {sym}: {len(bars)} days fetched, {len(series[sym])} saved")

    if failures and len(failures) == len(config["tickers"]):
        raise RuntimeError(f"every ticker failed, e.g. {failures[0]}")

    wanted = {t["symbol"] for t in config["tickers"]}
    return {
        "failures": failures,
        "series": {k: v for k, v in series.items() if k in wanted},
    }
