"""Daily open/high/low/close/volume for every ticker, watchlist stock and coin in config.json.

Coins are Yahoo pairs such as BTC-USD; coins added on the site arrive through the
hosted watchlist, the same as stocks.

Tries Yahoo Finance first (no key, no daily limit, a year of history per call),
then Alpha Vantage for any ticker Yahoo doesn't return. Set the order in
config.json under "api.priceSources", e.g. ["yahoo", "alphavantage"].

Each run merges into what is already saved, so history keeps growing.

Output (data/prices.json):
    {"updated", "failures": [...], "sources": {SYMBOL: "yahoo"|"alphavantage"},
     "series": {SYMBOL: {"YYYY-MM-DD": {o,h,l,c,v}}}}
"""
import re

from av_client import BudgetExceeded
from yahoo_client import Yahoo


def parse(payload: dict) -> dict:
    """Alpha Vantage TIME_SERIES_DAILY answer -> {day: {o,h,l,c,v}}."""
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


def from_alphavantage(client, sym):
    if client is None:
        raise RuntimeError("no Alpha Vantage key set")
    if sym.endswith("-USD") or sym.startswith("^") or re.search(r"\.[A-Z]{2,}$", sym):
        # coins, indexes (^VIX) and exchange-suffixed symbols come from Yahoo only
        raise RuntimeError("Alpha Vantage daily series doesn't cover this symbol")
    return parse(client.get("TIME_SERIES_DAILY", symbol=sym, outputsize="compact"))


def run(config, client, previous, yahoo=None):
    api = config.get("api", {})
    order = api.get("priceSources") or ["yahoo", "alphavantage"]
    yahoo = yahoo or Yahoo(api.get("yahooIntervalSeconds", 0.5), api.get("yahooHistory", "1y"))
    getters = {"yahoo": yahoo.daily, "alphavantage": lambda s: from_alphavantage(client, s)}

    series = (previous or {}).get("series", {})
    sources = dict((previous or {}).get("sources", {}))
    failures = []
    fallbacks = {}  # SYMBOL: why the earlier sources failed, when a later one worked
    # index tickers first, so they get any limited budget before the watchlist
    lists = config["tickers"] + config.get("watchlist", []) + config.get("crypto", []) + config.get("macro", [])
    symbols = list(dict.fromkeys(t["symbol"] for t in lists))
    for sym in symbols:
        problems = []
        for name in order:
            try:
                bars = getters[name](sym)
            except BudgetExceeded as e:
                problems.append(f"{name}: {e}")
                continue
            except Exception as e:  # try the next source; old data stays in place
                problems.append(f"{name}: {e}")
                continue
            series[sym] = dict(sorted({**series.get(sym, {}), **bars}.items()))
            sources[sym] = name
            if problems:
                fallbacks[sym] = " | ".join(problems)[:300]
            print(f"  prices {sym}: {len(bars)} days from {name}, {len(series[sym])} saved")
            break
        else:
            failures.append(f"{sym}: " + " | ".join(problems))

    if fallbacks:
        print(f"  prices: {len(fallbacks)} tickers used a backup source, e.g. {next(iter(fallbacks.items()))}")

    if failures and len(failures) == len(symbols):
        raise RuntimeError(f"every ticker failed, e.g. {failures[0]}")

    wanted = set(symbols)
    return {
        "failures": failures,
        "fallbacks": fallbacks,
        "sources": {k: v for k, v in sources.items() if k in wanted},
        "series": {k: v for k, v in series.items() if k in wanted},
    }
