"""Latest headlines for the stocks and coins the site shows.

Sources, tried in order per symbol: a Google News RSS search for the company or coin, then
Yahoo Finance's headline RSS feed (which often rate-limits GitHub's servers; yfinance's own
news call comes back empty there). Quote and listing pages are dropped, and the same story
from several sites is kept once.

Covers the watchlist (including coins added on the site), the pinned coins, today's
picks, cautions and top 10, and the primary index ETF. Keeps up to 5 headlines per
symbol from the last 14 days, newest first. A symbol whose news fails keeps what the
previous run saved. Run it after smallcaps and picks.

Output (data/news.json):
    {failures, items: {SYMBOL: [{title, publisher, url, time: ISO 8601}]}}
"""
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent.parent / "data"
PER_SYMBOL = 5
MAX_AGE_DAYS = 14
MAX_SYMBOLS = 60
PAUSE = 0.3   # seconds between symbols, to stay polite


def read(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text())
    except (OSError, ValueError):
        return {}


def symbols(config):
    picks, small = read("picks"), read("smallcaps")
    syms = [w["symbol"] for w in config.get("watchlist", [])]
    syms += [c["symbol"] for c in config.get("crypto", [])]
    syms += [r["symbol"] for r in picks.get("picks", []) + picks.get("cautions", [])]
    syms += [g["symbol"] for g in small.get("gainers", [])]
    if config.get("primary"):
        syms.append(config["primary"])
    return list(dict.fromkeys(syms))[:MAX_SYMBOLS]


def parse(item):
    """One yfinance news item, in either the older flat shape or the newer {content: {...}} shape."""
    c = item.get("content") or item
    title = c.get("title")
    url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
           or c.get("link") or item.get("link"))
    publisher = (c.get("provider") or {}).get("displayName") or c.get("publisher") or item.get("publisher") or ""
    when = c.get("pubDate") or c.get("displayTime")
    if not when and item.get("providerPublishTime"):
        when = datetime.fromtimestamp(item["providerPublishTime"], timezone.utc).isoformat()
    if not (title and url and when):
        return None
    try:
        t = datetime.fromisoformat(when.replace("Z", "+00:00"))
    except ValueError:
        return None
    return {"title": title.strip(), "publisher": publisher.strip(), "url": url,
            "time": t.astimezone(timezone.utc).isoformat(timespec="seconds")}


UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*"}


def rss(url):
    """[{title, publisher, url, time}] from an RSS 2.0 feed."""
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        when = it.findtext("pubDate")
        src = it.find("source")
        publisher = (src.text or "").strip() if src is not None and src.text else ""
        if not (title and link and when):
            continue
        try:
            t = parsedate_to_datetime(when).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        # Google News titles end with " - Publisher"; split it off
        if publisher and title.endswith(f" - {publisher}"):
            title = title[: -len(publisher) - 3]
        elif not publisher and " - " in title:
            title, publisher = title.rsplit(" - ", 1)
        out.append({"title": title, "publisher": publisher, "url": link, "time": t.isoformat(timespec="seconds")})
    return out


# listing and quote pages, and sites that publish machine-written stock blurbs
JUNK_TITLE = re.compile(r"stock price, news|quote & history|stock quote|price today|price prediction|live price|price chart", re.I)
JUNK_PUBLISHERS = {"ad-hoc-news.de", "Ad Hoc News"}


def junk(r):
    return bool(JUNK_TITLE.search(r["title"])) or r["publisher"] in JUNK_PUBLISHERS


def yahoo_rss(sym):
    q = urllib.parse.quote(sym)
    rows = rss(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={q}&region=US&lang=en-US")
    for r in rows:
        r["publisher"] = r["publisher"] or "Yahoo Finance"
    return rows


def google_rss(sym, name):
    coin = sym.endswith("-USD")
    what = f'"{name}"' if name else sym
    query = f"{what} {'crypto' if coin else 'stock'} when:14d" if name else f"{sym} stock when:14d"
    return rss("https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}))


def names(config):
    small = read("smallcaps").get("members", {})
    picks = read("picks")
    out = {s: v[0] for s, v in small.items() if v}
    for r in picks.get("picks", []) + picks.get("cautions", []):
        out.setdefault(r["symbol"], r.get("name"))
    for t in config.get("tickers", []) + config.get("watchlist", []) + config.get("crypto", []):
        if t.get("name"):
            out[t["symbol"]] = t["name"]
    return out


def run(config, client, previous):
    old = (previous or {}).get("items", {})
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    items, failures, used = {}, [], {}
    known = names(config)
    wanted = symbols(config)
    for sym in wanted:
        rows, problems = [], []
        for source, get in (("google", lambda: google_rss(sym, known.get(sym))), ("yahoo", lambda: yahoo_rss(sym))):
            try:
                rows = [r for r in get() if datetime.fromisoformat(r["time"]) >= cutoff and not junk(r)]
            except Exception as e:
                problems.append(f"{source}: {type(e).__name__}: {e}"[:150])
                rows = []
            if rows:
                used[source] = used.get(source, 0) + 1
                break
            time.sleep(PAUSE)
        if rows:
            seen, unique = set(), []
            for r in sorted(rows, key=lambda r: r["time"], reverse=True):
                key = re.sub(r"[^a-z0-9]+", " ", r["title"].lower())[:60]   # the same story on sister sites
                if key not in seen:
                    seen.add(key)
                    unique.append(r)
            items[sym] = unique[:PER_SYMBOL]
        else:
            items[sym] = old.get(sym, [])
            if problems:
                failures.append(f"{sym}: " + " | ".join(problems))
        time.sleep(PAUSE)
    if wanted and len(failures) == len(wanted):
        raise RuntimeError(f"no news for any symbol, e.g. {failures[0]}")
    print(f"  news: {sum(len(v) for v in items.values())} headlines for {len(items)} symbols; sources {used}; {len(failures)} failed")
    # a few failures are normal (small stocks with no coverage); they're logged, not flagged in the footer
    return {"failures": [], "items": items, "sources": used, "problems": failures[:5]}
