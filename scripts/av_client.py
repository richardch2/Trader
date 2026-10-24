"""Shared Alpha Vantage client.

Every fetcher calls the API through one client, so the free tier's limits
(5 calls a minute, 25 a day by default) are respected across all of them.
Set the limits in config.json under "api".
"""
import json
import time
import urllib.parse
import urllib.request

API = "https://www.alphavantage.co/query"


class BudgetExceeded(Exception):
    """Raised when a fetcher asks for more calls than the run has left."""


class ApiError(Exception):
    """Alpha Vantage answered, but with an error or limit message instead of data."""


class AlphaVantage:
    def __init__(self, key: str, daily_budget: int = 25, min_interval: float = 13):
        self.key = key
        self.budget = daily_budget
        self.min_interval = min_interval
        self.used = 0
        self._last = 0.0

    @property
    def remaining(self) -> int:
        return self.budget - self.used

    def get(self, function: str, **params) -> dict:
        if self.used >= self.budget:
            raise BudgetExceeded(f"daily budget of {self.budget} calls used up")
        wait = self.min_interval - (time.monotonic() - self._last)
        if self._last and wait > 0:
            time.sleep(wait)
        qs = urllib.parse.urlencode({"function": function, **params, "apikey": self.key})
        self.used += 1
        self._last = time.monotonic()
        with urllib.request.urlopen(f"{API}?{qs}", timeout=30) as r:
            payload = json.load(r)
        # Alpha Vantage reports limits and bad keys inside a 200 response
        for k in ("Error Message", "Note", "Information"):
            if k in payload and len(payload) == 1:
                raise ApiError(payload[k])
        return payload
