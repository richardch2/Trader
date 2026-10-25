#!/usr/bin/env python3
"""Checks the site before the workflow commits new data. Exits 1 if a page would break.

Errors (stop the run, so the last good data stays live):
  - config.json doesn't parse, or a page uses a card type with no js/cards/<type>.js
  - a JavaScript file has a syntax error (needs node; skipped if node isn't installed)
  - a data file the page loads isn't valid JSON, or prices.json has no prices at all

Warnings (shown on the run, nothing stops):
  - a tracked symbol has no prices yet, or its latest price is over 5 days older than the rest

Usage: python scripts/check_site.py
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors, warnings = [], []


def note(kind, msg):
    (errors if kind == "error" else warnings).append(msg)
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{kind}::{msg}")
    print(f"{kind}: {msg}")


def main() -> int:
    try:
        config = json.loads((ROOT / "config.json").read_text())
    except Exception as e:
        note("error", f"config.json doesn't parse: {e}")
        return 1

    # every card on every page has its module
    for page in config.get("pages", []):
        for card in page.get("cards", []):
            if not (ROOT / "js" / "cards" / f"{card.get('type')}.js").exists():
                note("error", f"page '{page.get('id')}' uses card '{card.get('type')}', but js/cards/{card.get('type')}.js is missing")

    # JavaScript syntax
    node = shutil.which("node")
    if node:
        for f in sorted((ROOT / "js").rglob("*.js")):
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            if r.returncode:
                note("error", f"{f.relative_to(ROOT)}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'syntax error'}")
    else:
        note("warning", "node isn't installed; JavaScript syntax not checked")

    # data files the page loads
    data = {}
    for f in config.get("fetchers", []):
        if f.get("enabled") is False:
            continue
        path = ROOT / "data" / f"{f['name']}.json"
        if not path.exists():
            note("warning", f"data/{f['name']}.json doesn't exist yet")
            continue
        try:
            data[f["name"]] = json.loads(path.read_text())
        except Exception as e:
            note("error", f"data/{f['name']}.json isn't valid JSON: {e}")

    series = (data.get("prices") or {}).get("series") or {}
    if "prices" in data and not any(series.values()):
        note("error", "prices.json has no prices for any ticker")

    # every tracked symbol has recent prices (coins and indexes judged on their own)
    lists = config.get("tickers", []) + config.get("watchlist", []) + config.get("crypto", []) + config.get("macro", [])
    latest = {s: max(v) for s, v in series.items() if v}
    if latest:
        newest = max(latest.values())
        for t in lists:
            sym = t["symbol"]
            if sym not in latest:
                note("warning", f"{sym} has no prices yet")
            elif (date.fromisoformat(newest) - date.fromisoformat(latest[sym])).days > 5:
                note("warning", f"{sym} last priced {latest[sym]}, others {newest}")

    print(f"site check: {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
