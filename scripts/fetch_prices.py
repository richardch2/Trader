#!/usr/bin/env python3
"""Fetch daily closes from Alpha Vantage for every ticker in tickers.json
and merge them into data/prices.json.

History accumulates: each run adds new days to what's already saved, so the
chart grows beyond Alpha Vantage's free 100-day window over time.

Usage:  ALPHAVANTAGE_API_KEY=xxx python scripts/fetch_prices.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TICKERS = ROOT / "tickers.json"
OUT = ROOT / "data" / "prices.json"
API = "https://www.alphavantage.co/query"
PAUSE = 13  # free tier allows 5 requests/minute


def fetch(symbol: str, key: str) -> dict:
    qs = urllib.parse.urlencode(
        {"function": "TIME_SERIES_DAILY", "symbol": symbol, "outputsize": "compact", "apikey": key}
    )
    with urllib.request.urlopen(f"{API}?{qs}", timeout=30) as r:
        return json.load(r)


def parse(payload: dict) -> dict:
    """Return {date: {o,h,l,c,v}} or raise with Alpha Vantage's own message."""
    series = payload.get("Time Series (Daily)")
    if not series:
        msg = payload.get("Note") or payload.get("Information") or payload.get("Error Message") or str(payload)[:200]
        raise RuntimeError(msg)
    out = {}
    for day, bar in series.items():
        out[day] = {
            "o": float(bar["1. open"]),
            "h": float(bar["2. high"]),
            "l": float(bar["3. low"]),
            "c": float(bar["4. close"]),
            "v": int(float(bar["5. volume"])),
        }
    return out


def main() -> int:
    key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not key:
        print("ALPHAVANTAGE_API_KEY is not set", file=sys.stderr)
        return 1

    config = json.loads(TICKERS.read_text())
    existing = json.loads(OUT.read_text()) if OUT.exists() else {"series": {}}
    series = existing.get("series", {})
    failures = []

    for i, t in enumerate(config["tickers"]):
        sym = t["symbol"]
        if i:
            time.sleep(PAUSE)
        try:
            bars = parse(fetch(sym, key))
        except Exception as e:  # keep going; old data stays in place
            failures.append(f"{sym}: {e}")
            print(f"! {sym}: {e}", file=sys.stderr)
            continue
        merged = {**series.get(sym, {}), **bars}
        series[sym] = dict(sorted(merged.items()))
        print(f"  {sym}: {len(bars)} days fetched, {len(merged)} total")

    # drop tickers no longer in the config
    wanted = {t["symbol"] for t in config["tickers"]}
    series = {k: v for k, v in series.items() if k in wanted}

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "benchmark": config.get("benchmark"),
        "tickers": config["tickers"],
        "failures": failures,
        "series": series,
    }, separators=(",", ":")))

    # fail the run only if nothing at all came back
    return 1 if len(failures) == len(config["tickers"]) else 0


if __name__ == "__main__":
    sys.exit(main())
