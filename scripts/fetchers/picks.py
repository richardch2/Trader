"""Daily stock ideas from moving averages, MACD and RSI.

Scans every Russell 2000 stock, plus the index tickers and the watchlist, for
technical signals (a 20-day average crossing the 50-day, price crossing the
50-day, MACD crossing its signal line, RSI leaving oversold, ...), scores each
stock and keeps the strongest. Uses none of the Alpha Vantage budget.

While the saved history is short or has gaps, it downloads the last ~4 months of
daily closes for every Russell 2000 stock from Yahoo Finance in one batch
(yfinance). iShares' own older holdings files are tried only if that fails.

Index tickers and watchlist stocks are read from data/prices.json. The rest of
the Russell 2000 come from a closing-price history this fetcher keeps in
data/picks-history.json, one day per iShares holdings file (see smallcaps.py).
While that history is shorter than KEEP_DAYS it downloads older holdings files,
up to BACKFILL_PER_RUN a run. Run it after prices and smallcaps.

Output (data/picks.json):
    {asOf, historyDays, scanned, picks: [row], cautions: [row], picksLow: [row], cautionsLow: [row],
     watchlist: {SYMBOL: row},
     backfillProblem (why older holdings files didn't download, or null), failures}
    row = {symbol, name, sector, price, score, signals: [{text, tone}],
           ind: {sma20, sma50, sma200, rsi, macd, macdSignal, mom20}}
"""
import json
from datetime import date, timedelta
from pathlib import Path

from fetchers.smallcaps import download, parse_holdings

DATA = Path(__file__).resolve().parent.parent.parent / "data"
HISTORY = DATA / "picks-history.json"

KEEP_DAYS = 60          # trading days of Russell 2000 closes to keep (50-day average + room for crosses)
BACKFILL_PER_RUN = 30   # older holdings files to try per run while history is short
YAHOO_PERIOD = "4mo"    # Yahoo history to fetch while history is short (~84 trading days)
MIN_DAYS = 21           # fewest closes a stock needs to be scanned
MIN_PRICE = 5.0         # ideas only for stocks at or above this price
LOW_BAND = (1.0, 5.0)   # a second set of ideas for stocks priced $1 to under $5
CROSS_WITHIN = 3        # a cross counts if it happened in the last few sessions
TOP_PICKS = 10
TOP_CAUTIONS = 5
MIN_SCORE = 3


# ---------- indicators (lists aligned with the closes, None until there is enough data) ----------

def sma(xs, n):
    out, total = [None] * len(xs), 0.0
    for i, x in enumerate(xs):
        total += x
        if i >= n:
            total -= xs[i - n]
        if i >= n - 1:
            out[i] = total / n
    return out


def ema(xs, n):
    out = [None] * len(xs)
    vals = [(i, x) for i, x in enumerate(xs) if x is not None]
    if len(vals) < n:
        return out
    k = 2 / (n + 1)
    i0 = vals[n - 1][0]
    out[i0] = prev = sum(x for _, x in vals[:n]) / n
    for i, x in vals[n:]:
        out[i] = prev = x * k + prev * (1 - k)
    return out


def rsi(xs, n=14):
    """Wilder's relative strength index."""
    out = [None] * len(xs)
    if len(xs) <= n:
        return out
    gains = [max(xs[i] - xs[i - 1], 0) for i in range(1, len(xs))]
    losses = [max(xs[i - 1] - xs[i], 0) for i in range(1, len(xs))]
    g, l = sum(gains[:n]) / n, sum(losses[:n]) / n
    for i in range(n, len(xs)):
        if i > n:
            g = (g * (n - 1) + gains[i - 1]) / n
            l = (l * (n - 1) + losses[i - 1]) / n
        out[i] = 100.0 if l == 0 else 100 - 100 / (1 + g / l)
    return out


def macd(xs):
    fast, slow = ema(xs, 12), ema(xs, 26)
    line = [f - s if f is not None and s is not None else None for f, s in zip(fast, slow)]
    return line, ema(line, 9)


def crossed(a, b, up=True):
    """Whether series a crossed series b (or a constant) in the last CROSS_WITHIN sessions."""
    n = CROSS_WITHIN + 1
    a = a[-n:]
    b = b[-n:] if isinstance(b, list) else [b] * len(a)
    if len(a) < n or any(v is None for v in a + b):
        return False
    above = [x > y for x, y in zip(a, b)]
    return above[-1] == up and any(v != up for v in above[:-1])


# ---------- scoring ----------

def analyze(closes, bench=None):
    """Score one stock from its closes, oldest first. None if there isn't enough history."""
    if len(closes) < MIN_DAYS:
        return None
    c = closes[-1]
    s20, s50, s200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    m, sig = macd(closes)
    r = rsi(closes)
    mom20 = c / closes[-21] - 1
    signals = []

    def add(points, text):
        signals.append((points, text))

    if s50[-1] is not None:
        if crossed(s20, s50):
            add(3, "20-day average crossed above the 50-day")
        elif crossed(s20, s50, up=False):
            add(-3, "20-day average crossed below the 50-day")
        if crossed(closes, s50):
            add(2, "Price crossed above the 50-day average")
        elif crossed(closes, s50, up=False):
            add(-2, "Price fell below the 50-day average")
        elif c > s20[-1] > s50[-1]:
            add(1, "Uptrend: above the 20- and 50-day averages")
        elif c < s20[-1] < s50[-1]:
            add(-1, "Downtrend: below the 20- and 50-day averages")
    elif crossed(closes, s20):
        add(1, "Price crossed above the 20-day average")
    elif crossed(closes, s20, up=False):
        add(-1, "Price fell below the 20-day average")

    if s200[-1] is not None:
        if crossed(s50, s200):
            add(3, "Golden cross: 50-day average above the 200-day")
        elif crossed(s50, s200, up=False):
            add(-3, "Death cross: 50-day average below the 200-day")

    if crossed(m, sig):
        add(2, "MACD crossed above its signal line")
    elif crossed(m, sig, up=False):
        add(-2, "MACD crossed below its signal line")

    if r[-1] is not None:
        if crossed(r, 30):
            add(2, "RSI rebounding from oversold")
        elif crossed(r, 70, up=False):
            add(-1, "RSI turning down from overbought")
        elif r[-1] > 70:
            add(-1, f"Overbought (RSI {r[-1]:.0f})")
        elif r[-1] < 30:
            add(0, f"Oversold (RSI {r[-1]:.0f})")

    if s20[-1] and c / s20[-1] - 1 > 0.15:
        add(-1, f"Stretched: {(c / s20[-1] - 1) * 100:.0f}% above the 20-day average")

    if bench and len(bench) > 20:
        rel = mom20 - (bench[-1] / bench[-21] - 1)
        if rel > 0.05:
            add(1, f"Beating the Russell 2000 by {rel * 100:.0f} pts over 20 days")
        elif rel < -0.05:
            add(-1, f"Trailing the Russell 2000 by {-rel * 100:.0f} pts over 20 days")

    rnd = lambda v, d=2: None if v is None else round(v, d)
    return {
        "price": c,
        "score": sum(p for p, _ in signals),
        "signals": [{"text": t, "tone": "pos" if p > 0 else "neg" if p < 0 else ""} for p, t in signals],
        "ind": {"sma20": rnd(s20[-1]), "sma50": rnd(s50[-1]), "sma200": rnd(s200[-1]), "rsi": rnd(r[-1], 1),
                "macd": rnd(m[-1], 3), "macdSignal": rnd(sig[-1], 3), "mom20": rnd(mom20, 4)},
    }


# ---------- Russell 2000 closing-price history ----------

def load_history():
    try:
        saved = json.loads(HISTORY.read_text())
    except (OSError, ValueError):
        return {}, set(), True
    hist = {d: {} for d in saved["dates"]}
    for sym, closes in saved["closes"].items():
        for d, c in zip(saved["dates"], closes):
            if c is not None:
                hist[d][sym] = c
    return hist, set(saved.get("noData", [])), saved.get("backfill", True)


def save_history(hist, no_data, backfill_ok):
    dates = sorted(hist)[-KEEP_DAYS:]
    syms = sorted({s for d in dates for s in hist[d]})
    oldest = dates[0] if dates else ""
    HISTORY.write_text(json.dumps({
        "dates": dates,
        "closes": {s: [hist[d].get(s) for d in dates] for s in syms},
        "noData": sorted(d for d in no_data if d >= oldest),
        "backfill": backfill_ok,
    }, separators=(",", ":")))


def closing(prices):
    """{symbol: close} rounded to cents, without the zero prices some holdings rows carry."""
    return {s: round(p, 2) for s, p in prices.items() if p and p > 0}


def backfill(hist, no_data):
    """Download older holdings files until there are KEEP_DAYS days. Returns (keep trying,
    last problem); keep trying is False if iShares ignores the date (every answer is the
    same newer file)."""
    day = date.fromisoformat(min(hist))
    floor = day - timedelta(days=KEEP_DAYS * 7 // 5 + 30)
    tries = errors = same = 0
    newest, problem = max(hist), None
    while len(hist) < KEEP_DAYS and tries < BACKFILL_PER_RUN and day > floor:
        day -= timedelta(days=1)
        d = day.isoformat()
        if day.weekday() >= 5 or d in no_data or d in hist:
            continue
        tries += 1
        try:
            got, stocks = parse_holdings(download(day))
        except Exception as e:  # network trouble or no file that day; try again next run
            errors += 1
            problem = f"{d}: {type(e).__name__}: {e}"[:300]
            print(f"  picks: no holdings for {problem}")
            if errors >= 3:
                break
            continue
        errors = 0
        if got != d:  # a holiday answers with another day's file
            no_data.add(d)
            same = same + 1 if got >= newest else 0
            if same >= 5:
                print("  picks: iShares ignores the date parameter; history will build one day per run")
                return False, "iShares ignores the date parameter"
            hist.setdefault(got, closing({s: v["price"] for s, v in stocks.items()}))
            continue
        same = 0
        hist[d] = closing({s: v["price"] for s, v in stocks.items()})
    print(f"  picks: {tries} older holdings files tried, history now {len(hist)} days")
    return True, problem


def yahoo_symbol(sym):
    """Holdings write share classes as 'MOG A' or 'BRK.B'; Yahoo writes MOG-A, BRK-B."""
    return sym.replace(" ", "-").replace(".", "-")


def yahoo_backfill(hist, members, period=YAHOO_PERIOD):
    """Add Yahoo daily closes for every member to hist. Returns (days added, problem or None)."""
    try:
        import yfinance as yf
    except ImportError:
        return 0, "yfinance is not installed"
    ysyms = {yahoo_symbol(s): s for s in members}
    try:
        df = yf.download(list(ysyms), period=period, interval="1d", auto_adjust=False,
                         actions=False, progress=False, threads=True, group_by="column")
    except Exception as e:
        return 0, f"Yahoo batch download failed: {type(e).__name__}: {e}"[:300]
    if df is None or df.empty or "Close" not in df:
        return 0, "Yahoo returned no prices"
    closes = df["Close"]
    before = len(hist)
    got = 0
    for ts, row in closes.iterrows():
        d = ts.date().isoformat()
        day = {}
        for ysym, c in row.items():
            if c == c and c is not None and c > 0:  # c == c drops NaN
                day[ysyms.get(ysym, ysym)] = round(float(c), 2)
        if len(day) < len(members) // 2:  # a holiday or a half-empty answer
            continue
        got = max(got, len(day))
        # keep a day the holdings file already gave; Yahoo fills the rest
        hist[d] = {**day, **hist.get(d, {})}
    print(f"  picks: Yahoo gave {len(closes)} days for up to {got} of {len(members)} stocks; history {before} -> {len(hist)} days")
    return len(hist) - before, None


# ---------- run ----------

def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def run(config, client, previous):
    prices = read("prices").get("series", {})
    small = read("smallcaps")
    members = small.get("members", {})

    hist, no_data, backfill_ok = load_history()
    problem = None
    if small.get("asOf") and small.get("prices"):
        hist[small["asOf"]] = closing(small["prices"])
    if not hist and not prices:
        raise RuntimeError("no prices or holdings to scan yet; run prices and smallcaps first")
    if members and len(hist) < KEEP_DAYS:
        added, problem = yahoo_backfill(hist, members)
        if not added and backfill_ok and hist:
            backfill_ok, problem = backfill(hist, no_data)
    if hist:
        save_history(hist, no_data, backfill_ok)
    dates = sorted(hist)[-KEEP_DAYS:]

    def closes(sym):
        s = prices.get(sym)
        if s and len(s) >= MIN_DAYS:
            return [b["c"] for _, b in sorted(s.items())]
        return [hist[d][sym] for d in dates if sym in hist[d]]

    named = {t["symbol"]: t.get("name") for t in config["tickers"] + config.get("watchlist", []) + config.get("crypto", [])}
    bench = closes(config.get("primary", "IWM"))

    def row(sym):
        a = analyze(closes(sym), bench)
        if a is None:
            return None
        name, sector = members.get(sym) or [named.get(sym), ""]
        return {"symbol": sym, "name": name or named.get(sym) or "", "sector": sector, **a}

    scanned = [r for r in map(row, members) if r]
    def best(ideas):
        picks = sorted((r for r in ideas if r["score"] >= MIN_SCORE),
                       key=lambda r: (r["score"], r["ind"]["mom20"]), reverse=True)[:TOP_PICKS]
        cautions = sorted((r for r in ideas if r["score"] <= -MIN_SCORE),
                          key=lambda r: (r["score"], r["ind"]["mom20"]))[:TOP_CAUTIONS]
        return picks, cautions

    picks, cautions = best([r for r in scanned if r["price"] >= MIN_PRICE])
    picks_low, cautions_low = best([r for r in scanned if LOW_BAND[0] <= r["price"] < LOW_BAND[1]])
    watch = {s: r for s in named if (r := row(s))}
    print(f"  picks: {len(scanned)} stocks scanned over {len(dates)} days, {len(picks)} picks, {len(cautions)} cautions; $1-$5: {len(picks_low)} picks, {len(cautions_low)} cautions")

    if not scanned and not watch:
        raise RuntimeError(f"not enough history to scan yet ({len(dates)} of {MIN_DAYS} days)")
    return {
        "asOf": max(dates) if dates else None,
        "historyDays": len(dates),
        "scanned": len(scanned),
        "picks": picks,
        "cautions": cautions,
        "picksLow": picks_low,
        "cautionsLow": cautions_low,
        "watchlist": watch,
        "backfillProblem": problem,
        "failures": [],
    }
