#!/usr/bin/env python3
"""Test pick-scoring rules against ~2 years of Russell 2000 prices (research/history.json.gz,
made by export_history.py).

Every rule ranks the stocks each day; the top 10 (after the same price band and trading
floor as the live lists) are "bought" at that day's close and scored by their return
5 and 20 trading days later, minus IWM's over the same days. Results are averaged over
days, separately for a tuning period and a later check period, so a rule that only fits
the past shows up as one that fails the check.

Caveat: the stock list is today's Russell 2000, so companies that dropped out (often the
worst performers) are missing. That flatters every rule about equally, which is why the
comparison is against the current rules and the index rather than in absolute terms.

Usage: python scripts/research/tune.py path/to/history.json.gz
"""
import gzip
import json
import sys

import numpy as np
import pandas as pd

TOP = 10
BANDS = {"$5+": (5.0, np.inf, 1_000_000), "$1-$5": (1.0, 5.0, 500_000)}
HORIZONS = (5, 20)


def load(path):
    raw = json.load(gzip.open(path, "rt"))
    idx = pd.to_datetime(raw["dates"])
    f = {k: pd.DataFrame(v, index=idx).astype(float) for k, v in raw["fields"].items()}
    iwm = f["close"].pop("IWM")
    for k in ("high", "low", "volume"):
        f[k] = f[k].drop(columns="IWM", errors="ignore")
    # a day where most stocks have no close is a bad row (holiday half-answers)
    good = f["close"].notna().mean(axis=1) > 0.5
    return {k: v[good] for k, v in f.items()}, iwm[good]


def features(f):
    c, v = f["close"], f["volume"]
    out = {}
    out["ret1"] = c.pct_change(1, fill_method=None)
    out["ret5"] = c.pct_change(5, fill_method=None)
    out["ret20"] = c.pct_change(20, fill_method=None)
    out["ret60"] = c.pct_change(60, fill_method=None)
    out["ret120"] = c.pct_change(120, fill_method=None)
    out["mom_12_1"] = c.shift(21) / c.shift(252) - 1
    s20, s50, s200 = (c.rolling(n, min_periods=n).mean() for n in (20, 50, 200))
    out["s20"], out["s50"], out["s200"] = s20, s50, s200
    out["vs20"], out["vs50"], out["vs200"] = c / s20 - 1, c / s50 - 1, c / s200 - 1
    hi252 = c.rolling(252, min_periods=120).max()
    out["off_high"] = c / hi252 - 1
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    out["rsi"] = 100 - 100 / (1 + up / dn)
    ema12, ema26 = c.ewm(span=12, adjust=False, min_periods=12).mean(), c.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = ema12 - ema26
    out["macd"], out["macd_sig"] = macd, macd.ewm(span=9, adjust=False, min_periods=9).mean()
    out["vol20"] = c.pct_change(fill_method=None).rolling(20, min_periods=15).std()
    avgv = v.shift(1).rolling(20, min_periods=10).mean()
    out["relvol"] = v / avgv
    out["dollarvol"] = (v * c).shift(1).rolling(20, min_periods=10).mean()
    return out


def crossed_up(a, b, within=3):
    """a crossed above b within the last `within` sessions (as in picks.crossed)."""
    above = a > b
    was_below = (~above).astype(float).rolling(within, min_periods=1).max().shift(1) > 0
    return above & was_below


def crossed_dn(a, b, within=3):
    return crossed_up(b, a, within)


def current_score(x, c, bench_ret20, long_window=False):
    """The live rules (picks.analyze), vectorized. Live data has 60 days per stock, so the
    200-day pieces never fire unless long_window is set."""
    s = pd.DataFrame(0.0, index=c.index, columns=c.columns)
    s20, s50 = x["s20"], x["s50"]
    s += 3 * crossed_up(s20, s50) - 3 * crossed_dn(s20, s50)
    pc_up, pc_dn = crossed_up(c, s50), crossed_dn(c, s50)
    s += 2 * pc_up - 2 * pc_dn
    trend = ~pc_up & ~pc_dn
    s += 1 * (trend & (c > s20) & (s20 > s50)) - 1 * (trend & (c < s20) & (s20 < s50))
    if long_window:
        s += 3 * crossed_up(s50, x["s200"]) - 3 * crossed_dn(s50, x["s200"])
    s += 2 * crossed_up(x["macd"], x["macd_sig"]) - 2 * crossed_dn(x["macd"], x["macd_sig"])
    r = x["rsi"]
    rsi_up = crossed_up(r, 30 + 0 * r)
    rsi_dn = crossed_dn(r, 70 + 0 * r)
    s += 2 * rsi_up - 1 * rsi_dn - 1 * (~rsi_up & ~rsi_dn & (r > 70))
    s -= 1 * (x["vs20"] > 0.15)
    rel = x["ret20"].sub(bench_ret20, axis=0)
    s += 1 * (rel > 0.05) - 1 * (rel < -0.05)
    return s


def forward(c, iwm, k):
    """Return k sessions ahead, and the same for IWM."""
    return c.shift(-k) / c - 1, iwm.shift(-k) / iwm - 1


def evaluate(score, c, x, fwd, periods, band, threshold=None, down=False, top=TOP):
    """Average excess return of each day's top picks, per period and horizon."""
    lo, hi, floor = BANDS[band]
    ok = (c >= lo) & (c < hi) & (x["dollarvol"] >= floor) & score.notna()
    if threshold is not None:
        ok &= (score <= -threshold) if down else (score >= threshold)
    sc = score.where(ok)
    rows = {}
    for name, (start, end) in periods.items():
        days = [d for d in sc.index if start <= d <= end]
        res = {}
        for k in HORIZONS:
            r, b = fwd[k]
            ex, raw, n = [], [], 0
            for d in days[::1]:
                s = sc.loc[d].dropna()
                if s.empty:
                    continue
                pick = (s.nsmallest(top) if down else s.nlargest(top)).index
                rr = r.loc[d, pick].dropna()
                if rr.empty or np.isnan(b.loc[d]):
                    continue
                raw.append(rr.mean()); ex.append(rr.mean() - b.loc[d]); n += len(rr)
            res[k] = (np.mean(raw) if raw else np.nan, np.mean(ex) if ex else np.nan,
                      (np.array(ex) > 0).mean() if ex else np.nan, len(ex))
        rows[name] = res
    return rows


def show(label, rows):
    parts = []
    for name, res in rows.items():
        for k in HORIZONS:
            raw, ex, beat, n = res[k]
            parts.append(f"{name} {k}d ex {ex * 100:+5.2f} ({beat * 100:3.0f}%)")
    print(f"{label:<44} " + " | ".join(parts))


def main(path):
    f, iwm = load(path)
    c = f["close"]
    x = features(f)
    bench20 = iwm.pct_change(20)
    fwd = {k: forward(c, iwm, k) for k in HORIZONS}
    dates = c.index
    start = dates[252]                     # a year of warm-up for the 12-month features
    end = dates[-21]                       # last day with a 20-day result
    split = dates[int(len(dates) * 0.70)]
    periods = {"tune": (start, split), "check": (split, end)}
    print(f"{len(c.columns)} stocks, {dates[0].date()} to {dates[-1].date()}; tune {start.date()}..{split.date()}, check {split.date()}..{end.date()}")
    return f, iwm, c, x, bench20, fwd, periods


if __name__ == "__main__":
    main(sys.argv[1])
