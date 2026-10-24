# Small Cap Tracker

A static page that tracks small-cap ETFs against the S&P 500, hosted on GitHub Pages and refreshed every
trading day by a GitHub Action. Live at **<https://richardch2.github.io/Trader/>**.

Everything is driven by `config.json`: which tickers to track, the watchlist, the pages in the menu and the
cards on each, and which data fetchers run each day.

**Pages:** Overview (`#overview`), Watchlist (`#watchlist`), and a detail page for any ticker (`#ticker/IWM`),
opened by tapping a row or a mover.

## Layout

```
config.json              tickers, watchlist, pages + cards, fetchers, API limits
index.html, styles.css   page shell and styles
js/main.js               loads config + data, builds the menu, mounts the current page's cards
js/core.js               the `ctx` every card gets: data helpers and shared state
js/lib/                  formatting and chart helpers
js/cards/*.js            one file per card type
scripts/update.py        runs every enabled fetcher, writes data/<name>.json
scripts/av_client.py     shared Alpha Vantage client (rate limit + daily budget)
scripts/fetchers/*.py    one file per kind of data
data/                    fetcher output, committed by the workflow
.github/workflows/       daily "Update data" job
```

## Setup (one time)

1. **API key** — free key at <https://www.alphavantage.co/support/#api-key>, saved as the repository secret
   `ALPHAVANTAGE_API_KEY` (*Settings → Secrets and variables → Actions*).
2. **Pages** — *Settings → Pages*: deploy from branch **main**, folder **/ (root)**.
3. **Data** — *Actions → Update data → Run workflow*. After that it runs Mon–Fri around 6:20pm Eastern.

## Common changes (config only)

**Watchlist** — add stocks to `watchlist`. `added` (the day you started watching) adds a "Since added"
column; `note` shows beside it and on the stock's page. Both are optional. The **Edit list** link on the
Watchlist page opens `config.json` on GitHub; prices for a new stock appear after the next daily update.

```json
"watchlist": [
  { "symbol": "CROX", "name": "Crocs", "added": "2026-10-24", "note": "Watching for a turn in margins" }
]
```

Index tickers are fetched first, so with the free key (25 calls a day, 8 used by the index list) keep the
watchlist to about 15 stocks; anything past the budget is skipped that day and noted in the page footer.

**Index tickers** — add to `tickers`. They appear on the Overview chart and table.

**Menu and pages** — each entry in `pages` is a menu item, in order:

```json
{ "id": "sectors", "title": "Sectors", "heading": "Sector ETFs", "cards": [ ... ] }
```

`id` is the address (`#sectors`), `title` the menu label, `heading` the page title (default: `title`).
`"hidden": true` keeps a page out of the menu (the ticker page works this way); `"ranges": false` hides
the period buttons on that page.

**Rearrange or remove cards** — reorder or delete entries in a page's `cards`. `"width"` is `"full"` or
`"half"`.

**Reuse a card with different tickers** — the built-in cards take options. Anywhere a symbol is expected
you can write `$primary`, `$benchmark`, or `$route` (the ticker in the address, on the ticker page).

| Card | Options |
|---|---|
| `headline` | `a`, `b`, `aName`, `bName` (defaults: `primary` vs `benchmark`). Renders as the page heading. |
| `performance` | `title`, `note`, `list` (`tickers` or `watchlist`) or `symbols: [...]`, `highlight: [...]` (`[]` = all bold) |
| `spread` | `title`, `note`, `a`, `b` — return of `a` minus return of `b` |
| `pair` | `title`, `note`, `series: [{symbol, label}, {symbol, label}]` |
| `table` | `title`, `note`, `list`, `columns: [{key, label, days}]`, `sparkDays`, `editable` (Edit list link) |
| `movers` | `title`, `note`, `list` (default `watchlist`), `days` (1 = today), `count` per side |
| `ticker` | `symbol` (default `$route`) — key figures and price chart for one ticker |

For example, a second spread card for small-cap value against the S&P 500:

```json
{ "type": "spread", "width": "half", "title": "Small value vs large", "a": "IWN", "b": "SPY" }
```

## Adding a new card

Create `js/cards/<type>.js` and add `{ "type": "<type>", ... }` to a page's `cards` in `config.json`.
That's all; `main.js` loads it by name.

```js
// js/cards/volume.js — average daily volume per ticker over the selected period
import { cardHead, h } from "../core.js";
import { compact } from "../lib/format.js";

export default function volume(opts, ctx) {
  let list;
  return {
    mount(el) {                       // once: build the card's structure
      cardHead(el, opts.title || "Volume", "Average shares traded per day.");
      list = h("div");
      el.append(list);
    },
    render() {                        // every time the period changes or the window resizes
      const win = new Set(ctx.window());
      list.replaceChildren(...ctx.tickers.map((t) => {
        const days = Object.entries(ctx.data.prices.series[t.symbol] || {}).filter(([d]) => win.has(d));
        const avg = days.reduce((s, [, b]) => s + b.v, 0) / (days.length || 1);
        return h("p", null, `${t.symbol}: ${compact(avg)}`);
      }));
    },
  };
}
```

What a card gets in `ctx` (see `js/core.js`):

- `ctx.config`, `ctx.tickers`, `ctx.watchlist`, `ctx.list(name)`, `ctx.primary`, `ctx.benchmark`, `ctx.dates`
- `ctx.route` — `{page, arg}` for the current address; `ctx.resolve("$route")` gives the ticker on a ticker page
- `ctx.href(sym)` — link to a ticker's page; `ctx.setHeading(text)` — set the page heading
- `ctx.data.<fetcher>` — the raw output of any fetcher, e.g. `ctx.data.prices.series.IWM["2026-10-23"].v`
- `ctx.series(sym)`, `ctx.bars(sym)`, `ctx.lastClose(sym)`, `ctx.ret(sym, days)`, `ctx.retSince(sym, date)`, `ctx.has(sym)`
- `ctx.window()`, `ctx.range()`, `ctx.rebased(sym)`, `ctx.spread(a, b)` — all follow the selected period
- `ctx.state`, `ctx.set({...})` — shared page state; changing it re-renders every card
- `ctx.color(sym)` — the ticker's series color token

Helpers: `lineChart`, `sparkline` in `js/lib/charts.js`; `pct`, `pts`, `money`, `compact`, `tone`, `date` in
`js/lib/format.js`. A card that throws shows an error in its own box; the rest of the page still loads.
Export `slot = "header"` to render into the page heading instead of a card box (see `headline.js`).

## Adding a new kind of data

Create `scripts/fetchers/<name>.py` with a `run(config, client, previous)` function that returns the JSON to
save, then add `{ "name": "<name>", "enabled": true }` to `fetchers` in `config.json`. The page loads
`data/<name>.json` as `ctx.data.<name>`.

```python
# scripts/fetchers/earnings.py — next earnings date per ticker (1 API call for all)
import csv, io

def run(config, client, previous):
    ...  # client.get("EARNINGS_CALENDAR", horizon="3month") etc.
    return {"failures": [], "dates": {"IWM": "2026-11-05"}}
```

- Always call the API through `client.get(function, **params)`; it waits between calls and stops at the
  daily budget, so fetchers can't starve each other.
- `previous` is what this fetcher saved last time: merge into it so history keeps growing.
- Put anything that didn't come back in `"failures"`; the page footer lists them.
- Raise an exception if nothing usable came back — the run is marked failed and the saved file is left alone.

**API budget.** The free tier allows 25 calls a day and 5 a minute (`api.dailyBudget`,
`api.minIntervalSeconds`). Prices use one call per ticker, so 8 today. Fetchers run in the order listed;
put the most important first. A paid key just needs a higher `dailyBudget` and lower `minIntervalSeconds`.

## Run locally

```sh
ALPHAVANTAGE_API_KEY=xxx python scripts/update.py          # all fetchers
ALPHAVANTAGE_API_KEY=xxx python scripts/update.py prices   # just one
python -m http.server 8000                                 # then open http://localhost:8000
```
