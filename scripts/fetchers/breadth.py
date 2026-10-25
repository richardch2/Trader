"""Market breadth and sector performance for the Russell 2000.

Reads the closing-price history the picks fetcher keeps (data/picks-history.json, ~60
trading days for every Russell 2000 stock) and the sectors from data/smallcaps.json.
No downloads and no API calls. Run it after picks.

Per day: how many stocks rose and fell, the share above their 20- and 50-day averages,
and new 20-day highs and lows. Per sector: the median 1-day, 1-week and 1-month return,
the share of its stocks that rose today, and its biggest movers today.

Output (data/breadth.json):
    {asOf, stocks, failures,
     days: [{d, adv, dec, above20, above50, highs, lows}],      oldest first; above* are 0..1 or null
     sectors: [{name, n, d1, w1, m1, advShare, up: [{symbol, change}], down: [...]}]}
"""
import json
from pathlib import Path
from statistics import median

DATA = Path(__file__).resolve().parent.parent.parent / "data"
MIN_STOCKS = 500        # fewer priced stocks than this on a day = a partial file; skip that day
MOVERS = 3              # movers listed per sector, each way
MIN_PRICE = 1.0         # ignore penny stocks for movers (their % moves swamp everything)


def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def run(config, client, previous):
    hist = read("picks-history")
    members = read("smallcaps").get("members", {})
    dates = hist.get("dates") or []
    closes = hist.get("closes") or {}
    if len(dates) < 2 or not closes:
        raise RuntimeError("not enough Russell 2000 history yet; run picks first")

    # only days with a reasonably full set of prices
    counts = [sum(1 for s in closes.values() if s[i] is not None) for i in range(len(dates))]
    keep = [i for i, n in enumerate(counts) if n >= MIN_STOCKS]

    def series(sym):
        s = closes[sym]
        return [s[i] for i in keep]

    days = [dates[i] for i in keep]
    out_days = []
    for j in range(1, len(days)):
        adv = dec = highs = lows = 0
        a20 = n20 = a50 = n50 = 0
        for sym in closes:
            s = series(sym)
            c, p = s[j], s[j - 1]
            if c is None or p is None:
                continue
            adv += c > p
            dec += c < p
            window = [x for x in s[max(0, j - 19): j + 1] if x is not None]
            if j >= 19 and len(window) == 20:
                n20 += 1
                a20 += c > sum(window) / 20
                prior = window[:-1]
                highs += c > max(prior)
                lows += c < min(prior)
            w50 = [x for x in s[max(0, j - 49): j + 1] if x is not None]
            if j >= 49 and len(w50) == 50:
                n50 += 1
                a50 += c > sum(w50) / 50
        out_days.append({
            "d": days[j], "adv": adv, "dec": dec,
            "above20": round(a20 / n20, 4) if n20 else None,
            "above50": round(a50 / n50, 4) if n50 else None,
            "highs": highs if n20 else None, "lows": lows if n20 else None,
        })

    # sectors: median returns over 1, 5 and 21 trading days, and today's movers
    def ret(s, n):
        return s[-1] / s[-1 - n] - 1 if len(s) > n and s[-1] and s[-1 - n] else None

    by_sector = {}
    for sym, info in members.items():
        if sym not in closes or not info or len(info) < 2 or not info[1]:
            continue
        s = series(sym)
        if s[-1] is None:
            continue
        by_sector.setdefault(info[1], []).append((sym, s))
    sectors = []
    for name, rows in by_sector.items():
        r1 = [(sym, ret(s, 1), s[-1]) for sym, s in rows]
        d1 = [r for _, r, _ in r1 if r is not None]
        w1 = [r for r in (ret(s, 5) for _, s in rows) if r is not None]
        m1 = [r for r in (ret(s, 21) for _, s in rows) if r is not None]
        movers = sorted((x for x in r1 if x[1] is not None and x[2] >= MIN_PRICE), key=lambda x: x[1])
        sectors.append({
            "name": name, "n": len(rows),
            "d1": round(median(d1), 5) if d1 else None,
            "w1": round(median(w1), 5) if w1 else None,
            "m1": round(median(m1), 5) if m1 else None,
            "advShare": round(sum(1 for r in d1 if r > 0) / len(d1), 4) if d1 else None,
            "up": [{"symbol": s, "change": round(r, 5)} for s, r, _ in reversed(movers[-MOVERS:]) if r > 0],
            "down": [{"symbol": s, "change": round(r, 5)} for s, r, _ in movers[:MOVERS] if r < 0],
        })
    sectors.sort(key=lambda x: -(x["d1"] or 0))
    today = out_days[-1] if out_days else {}
    print(f"  breadth: {len(out_days)} days through {today.get('d')}; today {today.get('adv')} up, {today.get('dec')} down; "
          f"{len(sectors)} sectors")
    return {"asOf": days[-1], "stocks": counts[keep[-1]], "failures": [], "days": out_days, "sectors": sectors}
