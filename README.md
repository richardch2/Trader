# Small Cap Tracker

A static page that tracks small-cap ETFs against the S&P 500, hosted on GitHub Pages and refreshed every
trading day by a GitHub Action. Live at **<https://richardch2.github.io/Trader/>**.

Everything is driven by `config.json`: which tickers to track, the watchlist, the pages in the menu and the
cards on each, and which data fetchers run each day.

**Pages:** Overview (`#overview`), Top 10 (`#top10`, the day's biggest Russell 2000 gainers), Picks
(`#picks`, daily ideas from moving averages, MACD and RSI), Watchlist (`#watchlist`), and a detail page for any
ticker (`#ticker/IWM`), opened by tapping a row or a mover.

Stocks are added to the watchlist from the site itself (Add buttons on the Top 10, an Add-a-ticker box, and
each ticker's page), stored in a free Supabase database with email sign-in. See *Hosted watchlist* below.

## Install as an app

The site installs like an app on a phone, tablet or computer and opens to the last saved data when offline.

- **iPhone / iPad (Safari):** tap **Install app** in the menu bar (or Share), then **Add to Home Screen**.
- **Android / Chrome / Edge:** tap **Install app** in the menu bar, or *Install app* in the browser menu.

`manifest.webmanifest` sets the name, icons (`icons/`) and colors; `sw.js` keeps a copy of each page and data
file it loads, always trying the network first so updates show up straight away.

## Layout

```
config.json              tickers, watchlist, pages + cards, fetchers, API limits
index.html, styles.css   page shell and styles
manifest.webmanifest     app name, icons and colors for installing; sw.js keeps it working offline
js/main.js               loads config + data, builds the menu, mounts the current page's cards
js/core.js               the `ctx` every card gets: data helpers and shared state
js/lib/                  formatting and chart helpers; db.js talks to the hosted watchlist
js/cards/*.js            one file per card type
scripts/update.py        runs every enabled fetcher, writes data/<name>.json
scripts/av_client.py     shared Alpha Vantage client (rate limit + daily budget)
scripts/fetchers/*.py    one file per kind of data (prices, smallcaps = Russell 2000 top gainers,
                         picks = technical signals)
supabase/setup.sql       one-time database setup for the hosted watchlist
data/                    fetcher output, committed by the workflow
.github/workflows/       daily "Update data" job
```

## Setup (one time)

1. **API key** — free key at <https://www.alphavantage.co/support/#api-key>, saved as the repository secret
   `ALPHAVANTAGE_API_KEY` (*Settings → Secrets and variables → Actions*).
2. **Pages** — *Settings → Pages*: deploy from branch **main**, folder **/ (root)**.
3. **Data** — *Actions → Update data → Run workflow*. After that it runs Mon–Fri around 6:20pm Eastern.

## Hosted watchlist (Supabase)

Until this is set up the site still works; the watchlist then comes only from `config.json` and the Add
buttons are hidden.

1. Create a free project at <https://supabase.com> (any name and region).
2. **SQL Editor → New query:** paste `supabase/setup.sql`, change `you@example.com` to your email, and **Run**.
   Only emails in the `editors` table can change the list; anyone can view it.
3. **Authentication → URL Configuration:** set *Site URL* to `https://richardch2.github.io/Trader/`.
4. **Project Settings → API:** copy the *Project URL* and the *anon public* key into `config.json`:
   ```json
   "supabase": { "url": "https://xxxx.supabase.co", "anonKey": "eyJ…" }
   ```
   The anon key is meant to be public; the database rules decide who can write.
5. Open the site, **Sign in** (top right), and use the emailed link.

The daily job reads the hosted list too, so stocks you add get price history from the next run. The list is
capped at 15 stocks to stay within the free API budget.

## Daily top 10

`scripts/fetchers/smallcaps.py` downloads the iShares Russell 2000 ETF holdings file (every stock in the
index with its last close), compares it with the previous run's prices, and keeps the 10 biggest gainers.
It costs no Alpha Vantage calls. Stocks under $1 and moves over +200% (usually reverse splits) are skipped.
iShares publishes the file a day after the close, so the list is labeled with the date it covers.

## Daily picks

`scripts/fetchers/picks.py` scans every Russell 2000 stock, the index tickers and the watchlist for technical
signals and scores each one. It costs no Alpha Vantage calls.

| Signal | Points |
|---|---|
| 20-day average crosses the 50-day (in the last 3 sessions) | ±3 |
| 50-day crosses the 200-day (golden / death cross, once there are 200 days) | ±3 |
| Price crosses the 50-day average | ±2 |
| MACD (12, 26) crosses its 9-day signal line | ±2 |
| RSI (14) climbs back above 30 | +2 |
| Price above (below) both the 20- and 50-day averages | ±1 |
| 20-day return beats (trails) the Russell 2000 by over 5 pts | ±1 |
| RSI over 70, turning down from 70, or price over 15% above the 20-day | −1 |

The Picks page lists the 10 highest scores of +3 or more (stocks of $5 and up), the 5 lowest of −3 or less, and
every watchlist stock's signals; each ticker's page shows its price with the 20- and 50-day averages. These are
mechanical signals, not advice. Thresholds are constants at the top of the file.

Watchlist and index stocks use their full price history from `data/prices.json`. For the rest, the fetcher keeps
60 days of Russell 2000 closes in `data/picks-history.json` (about 800 KB, not loaded by the page), one day per
iShares holdings file, so history builds one trading day per run: picks start after 21 trading days, and the
50-day signals after about 53. iShares doesn't serve older holdings files (it answers every date with the latest),
which the fetcher detected and recorded as `"backfill": false`; set it back to `true` to try again.

If you set up the hosted watchlist before the Picks page existed, run `supabase/allow-picks-source.sql` once in
the SQL Editor so stocks can be added from it.

## Common changes (config only)

**Watchlist in config.json** — besides the hosted list, stocks can be pinned in `watchlist`. `added` (the
day you started watching) adds a "Since added" column; `note` shows beside it and on the stock's page.
These can't be removed from the site.

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
| `ticker` | `symbol` (default `$route`) — key figures, price chart, and Add/Remove watchlist button |
| `topgainers` | `title`, `note`, `count` (default 10) — the day's top Russell 2000 gainers with Add buttons |
| `addticker` | `title`, `note` — add any ticker to the hosted watchlist, with Russell 2000 suggestions |
| `picks` | `title`, `note`, `list` (`picks`, `cautions`, `watchlist` or `tickers`), `count` — technical signals with scores |
| `technicals` | `symbol` (default `$route`) — price with 20- and 50-day averages, RSI, MACD and the day's signals |

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
- `ctx.db` (`enabled`, `email`, `canEdit`), `ctx.onWatchlist(sym)`, `ctx.addToWatchlist({symbol, name, note})`,
  `ctx.removeFromWatchlist(sym)`, `ctx.canRemove(sym)`, `ctx.toast(text)`
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
ALPHAVANTAGE_API_KEY=xxx python scripts/update.py smallcaps   # just one
python -m http.server 8000                                 # then open http://localhost:8000
```
