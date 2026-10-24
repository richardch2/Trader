"""Daily top gainers among Russell 2000 stocks.

Reads the iShares Russell 2000 ETF (IWM) holdings file, which lists every
stock in the index with its latest closing price. Comparing it with the
prices saved on the previous run gives each stock's daily change. This uses
none of the Alpha Vantage budget.

On the very first run there is nothing to compare with yet, so it falls back
to Alpha Vantage's market-wide top gainers (1 call), keeping only Russell
2000 members.

Output (data/smallcaps.json):
    {asOf, prevAsOf, count, source, gainers: [{symbol, name, sector, price, prev, change, weight}],
     members: {SYMBOL: [name, sector]}, prices: {SYMBOL: price}, failures}
"""
import csv
import io
import re
import urllib.request
from datetime import datetime

# iShares Russell 2000 ETF (IWM) holdings; tried in order
HOLDINGS_URLS = [
    "https://www.ishares.com/us/products/239710/x/latest-holdings.csv",
    "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund",
]
TOP_N = 10
MIN_PRICE = 1.0        # skip sub-$1 stocks
MAX_CHANGE = 2.0       # skip moves over +200%, almost always a reverse split or bad print


def num(s):
    s = (s or "").replace(",", "").replace("$", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def download() -> str:
    """Return the first holdings file that looks like CSV."""
    problems = []
    for url in HOLDINGS_URLS:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
            "Accept": "text/csv,*/*",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8-sig", errors="replace")
        except Exception as e:
            problems.append(f"{url}: {e}")
            continue
        if "\nTicker," in text:
            return text
        problems.append(f"{url}: not a holdings CSV (starts {text[:60]!r})")
    raise ValueError("; ".join(problems))


def parse_holdings(text: str):
    """Return (as_of 'YYYY-MM-DD', {symbol: {name, sector, price, weight}})."""
    lines = text.splitlines()
    as_of = None
    for line in lines[:12]:
        if line.lower().startswith("fund holdings as of"):
            m = re.search(r'"?([A-Za-z]{3} \d{1,2}, \d{4})"?', line)
            if m:
                as_of = datetime.strptime(m.group(1), "%b %d, %Y").date().isoformat()
    start = next((i for i, l in enumerate(lines) if l.startswith("Ticker,")), None)
    if start is None:
        raise ValueError(f"holdings file has no 'Ticker,' header (starts: {text[:120]!r})")
    if not as_of:
        raise ValueError("holdings file has no 'Fund Holdings as of' date")

    stocks = {}
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        if (row.get("Asset Class") or "").strip() != "Equity":
            continue
        sym = (row.get("Ticker") or "").strip().upper()
        price = num(row.get("Price"))
        if not sym or sym == "-" or price is None:
            continue
        stocks[sym] = {
            "name": (row.get("Name") or "").strip().title(),
            "sector": (row.get("Sector") or "").strip(),
            "price": price,
            "weight": num(row.get("Weight (%)")),
        }
    if len(stocks) < 1000:
        raise ValueError(f"only {len(stocks)} stocks parsed; the file format may have changed")
    return as_of, stocks


def rank(stocks, prev_prices):
    rows = []
    for sym, s in stocks.items():
        prev = prev_prices.get(sym)
        if not prev or s["price"] < MIN_PRICE:
            continue
        change = s["price"] / prev - 1
        if change > MAX_CHANGE:
            continue
        rows.append({"symbol": sym, "name": s["name"], "sector": s["sector"], "price": s["price"],
                     "prev": prev, "change": round(change, 5), "weight": s["weight"]})
    rows.sort(key=lambda r: r["change"], reverse=True)
    return rows[:TOP_N]


def market_gainers(client, stocks):
    """First-run fallback: Alpha Vantage's market-wide top gainers, Russell 2000 members only."""
    data = client.get("TOP_GAINERS_LOSERS")
    rows = []
    for g in data.get("top_gainers", []):
        sym = g.get("ticker", "").upper()
        if sym not in stocks:
            continue
        price = num(g.get("price"))
        change = num((g.get("change_percentage") or "").rstrip("%"))
        if price is None or change is None or price < MIN_PRICE:
            continue
        rows.append({"symbol": sym, "name": stocks[sym]["name"], "sector": stocks[sym]["sector"], "price": price,
                     "prev": round(price / (1 + change / 100), 4), "change": round(change / 100, 5),
                     "weight": stocks[sym]["weight"]})
    return rows[:TOP_N]


def run(config, client, previous):
    previous = previous or {}
    as_of, stocks = parse_holdings(download())
    print(f"  smallcaps: {len(stocks)} Russell 2000 stocks as of {as_of}")

    members = {s: [v["name"], v["sector"]] for s, v in stocks.items()}
    prices = {s: v["price"] for s, v in stocks.items()}

    # same holdings date as last run (weekend, holiday): keep the existing ranking
    if previous.get("asOf") == as_of:
        print("  smallcaps: holdings unchanged since last run, keeping the ranking")
        return {**previous, "members": members, "prices": prices, "failures": []}

    failures = []
    if previous.get("prices") and previous.get("asOf"):
        gainers, source, prev_as_of = rank(stocks, previous["prices"]), "holdings", previous["asOf"]
    else:
        prev_as_of = None
        try:
            gainers, source = market_gainers(client, stocks), "market-movers"
        except Exception as e:
            gainers, source = [], "none"
            failures.append(f"top gainers: {e}")
    print(f"  smallcaps: {len(gainers)} gainers ({source})")

    return {
        "asOf": as_of,
        "prevAsOf": prev_as_of,
        "count": len(stocks),
        "source": source,
        "gainers": gainers,
        "members": members,
        "prices": prices,
        "failures": failures,
    }
