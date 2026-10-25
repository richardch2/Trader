"""Yahoo Finance daily prices (no API key, no daily budget).

Uses Yahoo's public chart endpoint, the same one its website charts load.
It is unofficial, so it can change or rate-limit without notice; the prices
fetcher falls back to Alpha Vantage for any ticker Yahoo doesn't return.
"""
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:  # installed by the GitHub workflow; without it the direct endpoint is used
    import yfinance as yf
except ImportError:
    yf = None

HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Accept": "application/json",
}


class YahooError(Exception):
    """Yahoo answered without usable price data."""


class Yahoo:
    def __init__(self, min_interval: float = 0.5, history: str = "1y"):
        self.min_interval = min_interval
        self.history = history
        self.used = 0
        self._last = 0.0

    def _get(self, path: str, params: dict) -> dict:
        problems = []
        for host in HOSTS:
            wait = self.min_interval - (time.monotonic() - self._last)
            if self._last and wait > 0:
                time.sleep(wait)
            url = f"{host}{path}?{urllib.parse.urlencode(params)}"
            self.used += 1
            self._last = time.monotonic()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as r:
                    return json.load(r)
            except Exception as e:
                problems.append(f"{host}: {e}")
        raise YahooError("; ".join(problems))

    def daily(self, symbol: str) -> dict:
        """Return {"YYYY-MM-DD": {o,h,l,c,v}} for the last `history` of trading days."""
        # Yahoo writes share classes with a dash (BRK-B), Alpha Vantage with a dot (BRK.B)
        ysym = symbol.replace(".", "-")
        if yf is not None:
            try:
                return self._daily_yfinance(ysym)
            except Exception as e:
                first = f"yfinance: {type(e).__name__}: {e}"
            try:
                return self._daily_direct(ysym)
            except Exception as e:
                raise YahooError(f"{first}; direct: {e}") from None
        return self._daily_direct(ysym)

    def _daily_yfinance(self, ysym: str) -> dict:
        """yfinance handles the cookie/crumb check Yahoo applies to requests from servers."""
        wait = self.min_interval - (time.monotonic() - self._last)
        if self._last and wait > 0:
            time.sleep(wait)
        self.used += 1
        self._last = time.monotonic()
        df = yf.Ticker(ysym).history(period=self.history, interval="1d", auto_adjust=False, actions=False)
        if df is None or df.empty:
            raise YahooError("no price data in answer")
        bars = {}
        for ts, row in df.iterrows():
            vals = [row.get(k) for k in ("Open", "High", "Low", "Close")]
            if any(x is None or x != x for x in vals):  # x != x catches NaN
                continue
            vol = row.get("Volume")
            bars[ts.date().isoformat()] = {"o": round(float(vals[0]), 4), "h": round(float(vals[1]), 4),
                                           "l": round(float(vals[2]), 4), "c": round(float(vals[3]), 4),
                                           "v": int(vol) if vol == vol and vol is not None else 0}
        if not bars:
            raise YahooError("answer had dates but no complete prices")
        return bars

    def _daily_direct(self, ysym: str) -> dict:
        payload = self._get(f"/v8/finance/chart/{urllib.parse.quote(ysym)}",
                            {"range": self.history, "interval": "1d", "includePrePost": "false"})
        return parse_chart(payload)


def parse_chart(payload: dict) -> dict:
    chart = payload.get("chart") or {}
    if chart.get("error"):
        err = chart["error"]
        raise YahooError(err.get("description") or err.get("code") or str(err))
    result = (chart.get("result") or [None])[0]
    if not result or not result.get("timestamp"):
        raise YahooError("no price data in answer")

    offset = timedelta(seconds=(result.get("meta") or {}).get("gmtoffset", 0))
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    o, h, l, c, v = (quote.get(k) or [] for k in ("open", "high", "low", "close", "volume"))

    bars = {}
    for i, ts in enumerate(result["timestamp"]):
        vals = [arr[i] if i < len(arr) else None for arr in (o, h, l, c)]
        if any(x is None for x in vals):
            continue  # Yahoo leaves gaps (halts, today's unfinished bar) as nulls
        day = (datetime.fromtimestamp(ts, timezone.utc) + offset).date().isoformat()
        vol = v[i] if i < len(v) and v[i] is not None else 0
        bars[day] = {"o": round(vals[0], 4), "h": round(vals[1], 4), "l": round(vals[2], 4),
                     "c": round(vals[3], 4), "v": int(vol)}
    if not bars:
        raise YahooError("answer had dates but no complete prices")
    return bars
