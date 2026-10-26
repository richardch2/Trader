"""Today's small-cap movers while the market is open, refreshed every 30 minutes.

Run by .github/workflows/intraday.yml during market hours (and harmlessly by the daily
run, when it does nothing). One Yahoo batch download gives each Russell 2000 stock's
price and volume so far today and yesterday's close. Volume is compared with the stock's
20-day average scaled to how much of the session has passed, so a relative volume of 2.0
at noon means twice the usual pace. Thinly traded stocks are left out, as in smallcaps.py.

Outside market hours it returns the previous result unchanged. Set FORCE_INTRADAY=1 to
run anyway (for testing).

Output (data/intraday.json):
    {asOf (time of the scan), marketDate, elapsed (share of the session passed), scanned,
     gainers: [row], gainersLow: [row], failures}
    row = {symbol, name, sector, price, prev, change, vol, relVol, dollarVol}
"""
import json
import os
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from fetchers import picks
from fetchers.smallcaps import LOW_BAND, MAX_CHANGE, MIN_DOLLAR_VOL, MIN_DOLLAR_VOL_LOW, MIN_PRICE, TOP_N

NY = ZoneInfo("America/New_York")
DATA = Path(__file__).resolve().parent.parent.parent / "data"
OPEN, CLOSE = time(9, 30), time(16, 0)
SESSION_MIN = 390


def market_open(now):
    return now.weekday() < 5 and time(9, 35) <= now.time() <= time(16, 15)


def run(config, client, previous):
    now = datetime.now(NY)
    if not market_open(now) and not os.environ.get("FORCE_INTRADAY"):
        print("  intraday: market closed, nothing to do")
        return previous or {"asOf": None, "marketDate": None, "gainers": [], "gainersLow": [], "failures": []}

    try:
        members = json.loads((DATA / "smallcaps.json").read_text())["members"]
    except (OSError, ValueError, KeyError):
        raise RuntimeError("no Russell 2000 list yet; run smallcaps first")
    hist, _, _ = picks.load_history()
    today = now.date().isoformat()

    import yfinance as yf
    ysyms = {picks.yahoo_symbol(s): s for s in members}
    df = yf.download(list(ysyms), period="5d", interval="1d", auto_adjust=False,
                     actions=False, progress=False, threads=True, group_by="column")
    if df is None or df.empty or "Close" not in df or len(df.index) < 2:
        raise RuntimeError("Yahoo returned no prices")
    closes, vols = df["Close"], df["Volume"]
    last_ts, prev_ts = df.index[-1], df.index[-2]
    market_date = last_ts.date().isoformat()
    liq = picks.liquidity(hist, market_date)   # averages from the sessions before it

    minutes = (datetime.combine(now.date(), min(now.time(), CLOSE)) - datetime.combine(now.date(), OPEN)).seconds / 60
    elapsed = min(1.0, max(0.03, minutes / SESSION_MIN)) if market_date == today else 1.0

    rows = []
    for ysym, sym in ysyms.items():
        try:
            price, prev = float(closes.at[last_ts, ysym]), float(closes.at[prev_ts, ysym])
            vol = vols.at[last_ts, ysym]
        except KeyError:
            continue
        if not (price == price and prev == prev) or prev <= 0 or price < MIN_PRICE:
            continue
        change = price / prev - 1
        if change > MAX_CHANGE:
            continue
        v = liq.get(sym)
        floor = MIN_DOLLAR_VOL_LOW if price < LOW_BAND[1] else MIN_DOLLAR_VOL
        if liq and (not v or v["dollarVol"] < floor):
            continue
        vol = int(vol) if vol == vol else None
        rel = round(vol / (v["avgVol"] * elapsed), 2) if vol is not None and v and v["avgVol"] else None
        name, sector = members[sym]
        rows.append({"symbol": sym, "name": name, "sector": sector, "price": round(price, 4), "prev": round(prev, 4),
                     "change": round(change, 5), "vol": vol, "relVol": rel, "dollarVol": v and v["dollarVol"]})

    rows.sort(key=lambda r: r["change"], reverse=True)
    low = [r for r in rows if LOW_BAND[0] <= r["price"] < LOW_BAND[1]]
    print(f"  intraday: {len(rows)} stocks priced for {market_date}, {elapsed:.0%} of the session")
    return {
        "asOf": now.isoformat(timespec="minutes"),
        "marketDate": market_date,
        "elapsed": round(elapsed, 3),
        "scanned": len(rows),
        "gainers": rows[:TOP_N],
        "gainersLow": low[:TOP_N],
        "failures": [] if liq else ["no volume history: movers are not filtered for trading volume"],
    }
