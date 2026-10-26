"""Track record for the daily ideas: how each day's picks and cautions did afterwards.

Not a fetcher of its own: picks.py calls update() once a run. Every pick and caution is
logged with its price on the day (data/picks-log.json), and its return 5 and 20 trading
days later is filled in once those days have passed, next to the Russell 2000's (IWM)
return over the same days. A result is written once and never changed.

On the first run the log is started from a back-test: the same scoring re-run on each
day of a longer Yahoo history, flagged "bt" so it is never mistaken for the live record.

update() returns the summary that goes into data/picks.json under "track":
    {since, backtestFrom, backtestProblem,
     lists: {picks|cautions|picksLow|cautionsLow: {k5: stats, k20: stats, recent: [entry]}}}
    stats = {n, avg, hit, excess, beat, live}
      hit:  share that went the expected way (up for picks, down for cautions)
      beat: share that did better than the index the expected way
"""
import json
from datetime import date, timedelta
from pathlib import Path

LOG = Path(__file__).resolve().parent.parent.parent / "data" / "picks-log.json"
HORIZONS = (5, 20)
KEEP_DAYS = 400   # calendar days of log to keep
RECENT = 12


def load():
    try:
        return json.loads(LOG.read_text())
    except (OSError, ValueError):
        return {"entries": [], "started": None, "backtested": False}


def save(log):
    LOG.write_text(json.dumps(log, separators=(",", ":")))


def entries_for(lists, day, bt=False):
    out = []
    for name, rows in lists.items():
        for r in rows:
            e = {"d": day, "l": name, "s": r["symbol"], "p": r["price"], "sc": r["score"]}
            if bt:
                e["bt"] = 1
            out.append(e)
    return out


def evaluate(entries, hist, bench_series):
    """Fill in r5/b5 and r20/b20 where enough trading days have passed. Returns how many."""
    dates = sorted(hist)
    pos = {d: i for i, d in enumerate(dates)}
    done = 0
    for e in entries:
        i = pos.get(e["d"])
        if i is None:
            continue
        for k in HORIZONS:
            if f"r{k}" in e or i + k >= len(dates):
                continue
            later = dates[i + k]
            c = hist[later].get(e["s"])
            if c is None or not e["p"]:
                continue
            e[f"r{k}"] = round(c / e["p"] - 1, 4)
            b0, b1 = bench_series.get(e["d"]), bench_series.get(later)
            e[f"b{k}"] = round(b1["c"] / b0["c"] - 1, 4) if b0 and b1 else None
            done += 1
    return done


def stats(rows, k, down):
    got = [e for e in rows if e.get(f"r{k}") is not None]
    if not got:
        return {"n": 0}
    r = [e[f"r{k}"] for e in got]
    ex = [e[f"r{k}"] - e[f"b{k}"] for e in got if e.get(f"b{k}") is not None]
    sign = -1 if down else 1
    return {
        "n": len(got),
        "live": sum(1 for e in got if not e.get("bt")),
        "avg": round(sum(r) / len(r), 4),
        "hit": round(sum(1 for x in r if sign * x > 0) / len(r), 3),
        "excess": round(sum(ex) / len(ex), 4) if ex else None,
        "beat": round(sum(1 for x in ex if sign * x > 0) / len(ex), 3) if ex else None,
    }


def summary(log):
    out = {}
    for name in ("picks", "cautions", "picksLow", "cautionsLow"):
        rows = [e for e in log["entries"] if e["l"] == name]
        down = name.startswith("cautions")
        scored = [e for e in rows if e.get("r5") is not None]   # today's ideas are on the page already
        recent = sorted(scored, key=lambda e: (e["d"], abs(e["sc"])), reverse=True)[:RECENT]
        out[name] = {**{f"k{k}": stats(rows, k, down) for k in HORIZONS},
                     "recent": [{x: e.get(x) for x in ("d", "s", "p", "r5", "b5", "r20", "b20", "bt")} for e in recent]}
    bt = [e["d"] for e in log["entries"] if e.get("bt")]
    return {"since": log.get("started"), "backtestFrom": min(bt) if bt else None,
            "backtestProblem": log.get("backtestProblem"), "lists": out}


def update(lists, day, hist, bench_series, members, backtest=None):
    log = load()
    entries = log["entries"]

    if not log.get("backtested") and backtest:
        try:
            bt_lists, bt_hist = backtest()
            live_days = {e["d"] for e in entries if not e.get("bt")}
            fresh = [e for d, l in sorted(bt_lists.items()) if d not in live_days and d < day
                     for e in entries_for(l, d, bt=True)]
            evaluate(fresh, bt_hist, bench_series)
            entries[:] = [e for e in entries if not e.get("bt")] + fresh
            log["backtested"] = True
            log.pop("backtestProblem", None)
            print(f"  track: back-test added {len(fresh)} ideas over {len(bt_lists)} days")
        except Exception as e:
            log["backtestProblem"] = f"{type(e).__name__}: {e}"[:300]
            print(f"  track: back-test failed, will retry next run: {log['backtestProblem']}")

    # today's lists replace any earlier run on the same day
    entries[:] = [e for e in entries if not (e["d"] == day and not e.get("bt"))]
    entries.extend(entries_for(lists, day))
    log["started"] = log.get("started") or day
    filled = evaluate([e for e in entries if not e.get("bt")], hist, bench_series)

    cutoff = (date.fromisoformat(day) - timedelta(days=KEEP_DAYS)).isoformat()
    entries[:] = sorted((e for e in entries if e["d"] >= cutoff), key=lambda e: (e["d"], e["l"]))
    save(log)
    print(f"  track: {len(entries)} logged ideas, {filled} new results")
    return summary(log)
