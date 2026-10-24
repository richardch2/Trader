# Small Cap Tracker

A static page that tracks small-cap ETFs against the S&P 500, hosted on GitHub Pages and refreshed every trading day by a GitHub Action.

**What it shows**
- Headline: how small caps (IWM) did against SPY over the selected period
- Performance chart rebased to 100, with 1M / 3M / 6M / 1Y / All ranges and a hover tooltip
- Small-vs-large spread (IWM minus SPY) and Russell 2000 value vs growth (IWN vs IWO)
- A sortable table with price, 1D / 1W / 1M / 3M returns and a 3-month sparkline

## Setup (one time)

1. **API key** — get a free key at <https://www.alphavantage.co/support/#api-key>, then in this repo go to
   *Settings → Secrets and variables → Actions → New repository secret*, name it `ALPHAVANTAGE_API_KEY`.
2. **Pages** — *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, branch **main**, folder **/ (root)**.
3. **First data** — *Actions → Update prices → Run workflow*. When it finishes, the site is live at
   `https://richardch2.github.io/trader/`.

After that the workflow runs Mon–Fri at about 6:20pm Eastern.

## Adding tickers

Edit `tickers.json` and add an entry:

```json
{ "symbol": "CROX", "name": "Crocs", "group": "Watchlist" }
```

The free Alpha Vantage tier allows 25 requests a day and 5 a minute, so keep the list under about 20 tickers
(the script waits 13 s between calls).

## How data works

`scripts/fetch_prices.py` pulls the last 100 trading days per ticker and merges them into `data/prices.json`,
so history keeps growing past 100 days with each run. The 6M and 1Y buttons switch on once enough history
has built up. If a ticker fails on a given day, its older data stays and the page footer notes it.

Run locally:

```sh
ALPHAVANTAGE_API_KEY=xxx python scripts/fetch_prices.py
python -m http.server 8000   # then open http://localhost:8000
```
