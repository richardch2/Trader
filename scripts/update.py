#!/usr/bin/env python3
"""Run every enabled fetcher in config.json and save its output to data/<name>.json.

Usage:
    ALPHAVANTAGE_API_KEY=xxx python scripts/update.py            # all enabled fetchers
    ALPHAVANTAGE_API_KEY=xxx python scripts/update.py prices     # just one
"""
import importlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from av_client import AlphaVantage  # noqa: E402

DATA = ROOT / "data"


def main(argv) -> int:
    key = os.environ.get("ALPHAVANTAGE_API_KEY")
    if not key:
        print("ALPHAVANTAGE_API_KEY is not set (add it as a repository secret)", file=sys.stderr)
        return 1

    config = json.loads((ROOT / "config.json").read_text())
    api = config.get("api", {})
    client = AlphaVantage(key, api.get("dailyBudget", 25), api.get("minIntervalSeconds", 13))

    only = set(argv)
    fetchers = [f for f in config.get("fetchers", []) if f.get("enabled", True) and (not only or f["name"] in only)]
    DATA.mkdir(exist_ok=True)
    ok = 0

    for f in fetchers:
        name = f["name"]
        out = DATA / f"{name}.json"
        previous = json.loads(out.read_text()) if out.exists() else None
        print(f"[{name}] {client.remaining} API calls left")
        try:
            result = importlib.import_module(f"fetchers.{name}").run(config, client, previous)
        except Exception as e:
            print(f"! {name} failed: {e}", file=sys.stderr)
            continue
        result["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for msg in result.get("failures", []):
            print(f"! {name} {msg}", file=sys.stderr)
        out.write_text(json.dumps(result, separators=(",", ":")))
        ok += 1

    print(f"done: {ok}/{len(fetchers)} fetchers, {client.used} API calls")
    return 0 if ok or not fetchers else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
