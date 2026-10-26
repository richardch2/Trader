"""Dilution and squeeze risk for the stocks the site lists: float, short interest,
growth in shares outstanding, and recent reverse splits.

Low-priced small caps often sink on a share sale (more shares, each worth less) or
after a reverse split, and run hard when heavily shorted with a small float. This reads
those facts from Yahoo Finance for every stock on the Top 10s, the idea lists and the
watchlist (not index ETFs or coins), and turns them into short flags.

Each stock is looked up at most once every REFRESH_DAYS days and the rest is reused, so a
run makes a few dozen requests. Run it after smallcaps and picks.

Output (data/risk.json):
    {asOf, failures, stocks: {SYMBOL: {checked, float, sharesOut, sharesChange, shortPct,
      shortRatio, shortDate, split: {date, ratio} | null, flags: [{text, short, tone}]}}}
    tone "neg" (dilution, reverse split) or "warn" (heavily shorted, small float)
"""
import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fetchers.picks import yahoo_symbol

DATA = Path(__file__).resolve().parent.parent.parent / "data"
REFRESH_DAYS = 3
MAX_LOOKUPS = 120          # per run, so a long list can't stall the update
TIME_BUDGET = 540          # seconds
PAUSE = 2.0                # between lookups: Yahoo rate-limits quick bursts
DILUTION = 0.20            # shares outstanding up this much in a year
HIGH_SHORT = 0.15          # short interest as a share of the float
LOW_FLOAT = 10_000_000     # shares
SPLIT_DAYS = 365


def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def symbols(config):
    small, ideas = read("smallcaps"), read("picks")
    out = []
    for r in small.get("gainers", []) + small.get("gainersLow", []):
        out.append(r["symbol"])
    for k in ("picks", "cautions", "picksLow", "cautionsLow"):
        out += [r["symbol"] for r in ideas.get(k, [])]
    out += [r["symbol"] for r in read("intraday").get("gainers", []) + read("intraday").get("gainersLow", [])]
    out += [w["symbol"] for w in config.get("watchlist", [])]
    skip = {t["symbol"] for t in config.get("tickers", [])}
    seen = []
    for s in out:
        if s not in skip and not s.endswith("-USD") and not s.startswith("^") and s not in seen:
            seen.append(s)
    return seen


def millions(n):
    return f"{n / 1e6:.1f}M" if n < 1e9 else f"{n / 1e9:.1f}B"


def flags(r):
    out = []
    sp = r.get("split")
    if sp and sp["ratio"] < 1:
        n = round(1 / sp["ratio"])
        out.append({"text": f"Reverse split 1-for-{n} on {sp['date']}", "short": "Reverse split", "tone": "neg"})
    ch = r.get("sharesChange")
    if ch is not None and ch >= DILUTION:
        out.append({"text": f"Shares outstanding up {ch * 100:.0f}% in a year (dilution)",
                    "short": f"Dilution +{ch * 100:.0f}%", "tone": "neg"})
    sh = r.get("shortPct")
    if sh is not None and sh >= HIGH_SHORT:
        out.append({"text": f"{sh * 100:.0f}% of the float sold short"
                            + (f", {r['shortRatio']:.1f} days to cover" if r.get("shortRatio") else ""),
                    "short": f"Short {sh * 100:.0f}%", "tone": "warn"})
    fl = r.get("float")
    if fl is not None and 0 < fl < LOW_FLOAT:
        out.append({"text": f"Small float: {millions(fl)} shares trade freely", "short": "Low float", "tone": "warn"})
    return out


def lookup(sym):
    import yfinance as yf
    t = yf.Ticker(yahoo_symbol(sym))
    info = t.info or {}
    num = lambda k: info.get(k) if isinstance(info.get(k), (int, float)) else None
    r = {
        "checked": date.today().isoformat(),
        "float": num("floatShares"),
        "sharesOut": num("sharesOutstanding"),
        "shortPct": num("shortPercentOfFloat"),
        "shortRatio": num("shortRatio"),
        "shortDate": None,
        "sharesChange": None,
        "split": None,
    }
    if num("dateShortInterest"):
        r["shortDate"] = datetime.fromtimestamp(info["dateShortInterest"], timezone.utc).date().isoformat()
    try:
        splits = t.splits
        if splits is not None and len(splits):
            ts, ratio = splits.index[-1], float(splits.iloc[-1])
            d = ts.date()
            if (date.today() - d).days <= SPLIT_DAYS:
                r["split"] = {"date": d.isoformat(), "ratio": ratio}
    except Exception:
        pass
    try:
        start = date.today() - timedelta(days=400)
        sh = t.get_shares_full(start=start.isoformat())
        if sh is not None and len(sh) > 1:
            sh = sh[~sh.index.duplicated(keep="last")].sort_index()
            year_ago = sh[sh.index.date <= date.today() - timedelta(days=365)]
            first = float(year_ago.iloc[-1]) if len(year_ago) else float(sh.iloc[0])
            last = float(r["sharesOut"] or sh.iloc[-1])
            if first > 0:
                change = last / first - 1
                # a reverse split shrinks the count; adjust so it doesn't hide a share sale
                if r["split"] and r["split"]["date"] > (date.today() - timedelta(days=365)).isoformat():
                    change = last / (first * r["split"]["ratio"]) - 1
                r["sharesChange"] = round(change, 4)
    except Exception:
        pass
    r["flags"] = flags(r)
    return r


def run(config, client, previous):
    previous = previous or {}
    old = previous.get("stocks", {})
    want = symbols(config)
    fresh_after = (date.today() - timedelta(days=REFRESH_DAYS)).isoformat()
    stocks, failures, looked, started = {}, [], 0, time.time()
    limited = 0
    for sym in want:
        prev = old.get(sym)
        if prev and prev.get("checked", "") > fresh_after:
            stocks[sym] = {**prev, "flags": flags(prev)}
            continue
        if looked >= MAX_LOOKUPS or time.time() - started > TIME_BUDGET:
            if prev:
                stocks[sym] = prev
            continue
        if limited >= 3:   # still rate-limited after backing off: keep the rest for next run
            if prev:
                stocks[sym] = prev
            continue
        looked += 1
        for attempt in range(2):
            time.sleep(PAUSE if attempt == 0 else 60)
            try:
                stocks[sym] = lookup(sym)
                limited = 0
                break
            except Exception as e:
                rate = "RateLimit" in type(e).__name__ or "Too Many Requests" in str(e)
                if rate and attempt == 0:
                    continue
                limited += rate
                failures.append(f"{sym}: {type(e).__name__}: {e}"[:200])
                if prev:
                    stocks[sym] = prev
                break
    if want and looked and len(failures) == looked:
        failures = [f"every lookup failed ({looked}); first: {failures[0]}"]
    elif len(failures) > 5:
        failures = failures[:5] + [f"and {len(failures) - 5} more"]
    print(f"  risk: {len(stocks)} of {len(want)} stocks, {looked} looked up, "
          f"{sum(1 for r in stocks.values() if r.get('flags'))} flagged")
    return {"asOf": date.today().isoformat(), "stocks": stocks, "failures": failures}
