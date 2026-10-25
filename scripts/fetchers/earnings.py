"""Next earnings date for the stocks the site shows.

Alpha Vantage's EARNINGS_CALENDAR lists every US company reporting in the next
3 months in ONE call, so with a key this covers all Russell 2000 stocks plus the
watchlist. Without a key (or if that call fails) it asks Yahoo Finance, one stock
at a time, for the stocks on screen: the watchlist, today's picks and cautions,
and the top 10. Coins, ETFs and indexes have no earnings and are skipped.

Run it after smallcaps and picks, so their lists are current.

Output (data/earnings.json):
    {source, failures, dates: {SYMBOL: {date: "YYYY-MM-DD", time: "pre-market"|"post-market"|null,
                                         estimate: EPS or null}}}
"""
import csv
import io
import json
from datetime import date, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent.parent / "data"
YAHOO_MAX = 80        # stocks to ask Yahoo about, one call each, when Alpha Vantage isn't available


def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def is_stock(sym, etfs):
    return sym not in etfs and not sym.endswith("-USD") and not sym.startswith("^") and "." not in sym[-4:]


def on_screen(config):
    """Stocks the site shows today: watchlist first, then picks, cautions and the top 10."""
    etfs = {t["symbol"] for t in config.get("tickers", [])}
    picks, small = read("picks"), read("smallcaps")
    syms = [w["symbol"] for w in config.get("watchlist", [])]
    syms += [r["symbol"] for r in picks.get("picks", []) + picks.get("cautions", [])]
    syms += [g["symbol"] for g in small.get("gainers", [])]
    return [s for s in dict.fromkeys(syms) if is_stock(s, etfs)]


def from_alphavantage(client, wanted):
    text = client.get_text("EARNINGS_CALENDAR", horizon="3month")
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        sym = (row.get("symbol") or "").strip().upper()
        when = (row.get("reportDate") or "").strip()
        if sym not in wanted or not when:
            continue
        est = row.get("estimate")
        try:
            est = float(est) if est not in (None, "") else None
        except ValueError:
            est = None
        if sym not in out or when < out[sym]["date"]:   # keep the soonest report
            out[sym] = {"date": when, "time": (row.get("timeOfTheDay") or "").strip() or None, "estimate": est}
    if len(out) < 50 and len(wanted) > 500:
        raise RuntimeError(f"calendar matched only {len(out)} stocks; the format may have changed")
    return out


def from_yahoo(symbols):
    import yfinance as yf
    today = date.today().isoformat()
    out, failures = {}, []
    for sym in symbols[:YAHOO_MAX]:
        try:
            cal = yf.Ticker(sym.replace(".", "-")).calendar or {}
            days = [d.isoformat() if hasattr(d, "isoformat") else str(d) for d in cal.get("Earnings Date") or []]
            days = sorted(d for d in days if d >= today)
            if days:
                est = cal.get("Earnings Average")
                out[sym] = {"date": days[0], "time": None, "estimate": round(float(est), 2) if est is not None else None}
        except Exception as e:
            failures.append(f"{sym}: {type(e).__name__}: {e}"[:200])
    return out, failures


def run(config, client, previous):
    etfs = {t["symbol"] for t in config.get("tickers", [])}
    members = read("smallcaps").get("members", {})
    screen = on_screen(config)
    wanted = set(members) | set(screen)
    failures = []
    try:
        dates, source = from_alphavantage(client, wanted), "alphavantage"
    except Exception as e:
        print(f"  earnings: Alpha Vantage calendar unavailable ({type(e).__name__}: {e}); asking Yahoo")
        dates, failures = from_yahoo(screen)
        source = "yahoo"
        if not dates and screen:
            raise RuntimeError(f"no earnings dates from either source; e.g. {failures[:1]}")

    # keep earlier dates that are still ahead for stocks this run didn't cover
    today = date.today().isoformat()
    for sym, d in ((previous or {}).get("dates") or {}).items():
        if sym not in dates and d.get("date", "") >= today and is_stock(sym, etfs):
            dates[sym] = d
    soon = sum(1 for d in dates.values() if d["date"] <= (date.today() + timedelta(days=14)).isoformat())
    print(f"  earnings: {len(dates)} upcoming from {source}, {soon} in the next 14 days")
    if failures:  # a few small stocks have no Yahoo calendar; that's normal, so log it rather than flag it
        print(f"  earnings: no Yahoo calendar for {len(failures)} stocks, e.g. {failures[0]}")
    return {"source": source, "failures": [], "dates": dict(sorted(dates.items()))}
