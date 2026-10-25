"""Latest headlines for the stocks and coins the site shows, from Yahoo Finance (yfinance).

Covers the watchlist (including coins added on the site), the pinned coins, today's
picks, cautions and top 10, and the primary index ETF. Keeps up to 5 headlines per
symbol from the last 14 days, newest first. A symbol whose news fails keeps what the
previous run saved. Run it after smallcaps and picks.

Output (data/news.json):
    {failures, items: {SYMBOL: [{title, publisher, url, time: ISO 8601}]}}
"""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent.parent / "data"
PER_SYMBOL = 5
MAX_AGE_DAYS = 14
MAX_SYMBOLS = 60
PAUSE = 0.3   # seconds between symbols, to stay polite


def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def symbols(config):
    picks, small = read("picks"), read("smallcaps")
    syms = [w["symbol"] for w in config.get("watchlist", [])]
    syms += [c["symbol"] for c in config.get("crypto", [])]
    syms += [r["symbol"] for r in picks.get("picks", []) + picks.get("cautions", [])]
    syms += [g["symbol"] for g in small.get("gainers", [])]
    if config.get("primary"):
        syms.append(config["primary"])
    return list(dict.fromkeys(syms))[:MAX_SYMBOLS]


def parse(item):
    """One yfinance news item, in either the older flat shape or the newer {content: {...}} shape."""
    c = item.get("content") or item
    title = c.get("title")
    url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
           or c.get("link") or item.get("link"))
    publisher = (c.get("provider") or {}).get("displayName") or c.get("publisher") or item.get("publisher") or ""
    when = c.get("pubDate") or c.get("displayTime")
    if not when and item.get("providerPublishTime"):
        when = datetime.fromtimestamp(item["providerPublishTime"], timezone.utc).isoformat()
    if not (title and url and when):
        return None
    try:
        t = datetime.fromisoformat(when.replace("Z", "+00:00"))
    except ValueError:
        return None
    return {"title": title.strip(), "publisher": publisher.strip(), "url": url,
            "time": t.astimezone(timezone.utc).isoformat(timespec="seconds")}


def run(config, client, previous):
    import yfinance as yf
    old = (previous or {}).get("items", {})
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    items, failures = {}, []
    wanted = symbols(config)
    for sym in wanted:
        try:
            raw = yf.Ticker(sym.replace(".", "-") if sym[-2:-1] == "." else sym).news or []
            rows = [r for r in map(parse, raw) if r]
            rows = [r for r in rows if datetime.fromisoformat(r["time"]) >= cutoff]
            seen, unique = set(), []
            for r in sorted(rows, key=lambda r: r["time"], reverse=True):
                if r["title"] not in seen:
                    seen.add(r["title"])
                    unique.append(r)
            items[sym] = unique[:PER_SYMBOL]
        except Exception as e:
            failures.append(f"{sym}: {type(e).__name__}: {e}"[:200])
            if sym in old:
                items[sym] = old[sym]
        time.sleep(PAUSE)
    if wanted and len(failures) == len(wanted):
        raise RuntimeError(f"no news for any symbol, e.g. {failures[0]}")
    print(f"  news: {sum(len(v) for v in items.values())} headlines for {len(items)} symbols, {len(failures)} failed")
    # a few failures are normal (small stocks with no coverage); log them instead of flagging the footer
    return {"failures": [], "items": items}
