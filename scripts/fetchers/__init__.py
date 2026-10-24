"""Fetchers: one module per kind of data.

A fetcher is a module in this folder with:

    def run(config: dict, client: AlphaVantage, previous: dict | None) -> dict

- config   – the whole config.json
- client   – the shared Alpha Vantage client (respects the call budget)
- previous – what this fetcher wrote last time (data/<name>.json), or None

It returns the JSON to save as data/<name>.json. Include a "failures" list
of strings for anything that didn't come back; keep the old data for those.

Turn it on by adding {"name": "<module name>", "enabled": true} to
"fetchers" in config.json.
"""
