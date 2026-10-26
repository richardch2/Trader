#!/usr/bin/env python3
"""Download ~2 years of daily closes, highs, lows and volumes for every Russell 2000 stock
(plus IWM) from Yahoo and write research/history.json.gz. For testing the pick scoring
offline; run by .github/workflows/research.yml, which pushes the file to the "research"
branch so it never reaches the live site."""
import gzip
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from fetchers.picks import yahoo_symbol  # noqa: E402

import yfinance as yf  # noqa: E402

members = json.loads((ROOT / "data" / "smallcaps.json").read_text())["members"]
ysyms = {yahoo_symbol(s): s for s in members}
ysyms["IWM"] = "IWM"
out = {"dates": None, "fields": {}}
frames = []
syms = list(ysyms)
for i in range(0, len(syms), 500):   # chunks, with pauses: Yahoo rate-limits big bursts
    chunk = syms[i:i + 500]
    for wait in (0, 30, 90):
        time.sleep(wait)
        df = yf.download(chunk, period="2y", interval="1d", auto_adjust=True, actions=False,
                         progress=False, threads=True, group_by="column")
        if df is not None and not df.empty:
            break
    print(f"chunk {i}: {0 if df is None else df.shape}")
    frames.append(df)
    time.sleep(10)

import pandas as pd  # noqa: E402
df = pd.concat(frames, axis=1)
dates = [ts.date().isoformat() for ts in df.index]
out["dates"] = dates
for field in ("Close", "High", "Low", "Volume"):
    sub = df[field]
    col = {}
    for ysym in sub.columns:
        vals = sub[ysym].tolist()
        col[ysyms.get(ysym, ysym)] = [None if v != v else (int(v) if field == "Volume" else round(float(v), 4)) for v in vals]
    out["fields"][field.lower()] = col
out["members"] = members
path = ROOT / "research" / "history.json.gz"
path.parent.mkdir(exist_ok=True)
with gzip.open(path, "wt") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"{len(dates)} days, {len(out['fields']['close'])} symbols, {path.stat().st_size / 1e6:.1f} MB")
