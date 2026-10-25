# Small Cap Tracker

A static page that tracks small-cap ETFs against the S&P 500, hosted on GitHub Pages and refreshed every
trading day by a GitHub Action. Live at **<https://richardch2.github.io/Trader/>**.

Everything is driven by `config.json`: which tickers to track, the watchlist, the pages in the menu and the
cards on each, and which data fetchers run each day.

**Pages:** Overview (`#overview`, with the macro backdrop, Russell 2000 breadth and a sector map), Top 10 (`#top10`, the
day's biggest Russell 2000 gainers), Picks (`#picks`, daily ideas from moving averages, MACD and RSI), Watchlist
(`#watchlist`), Crypto (`#crypto`), Portfolio (`#portfolio`: your positions and price alerts), and a detail page for any ticker (`#ticker/IWM`) or coin (`#coin/BTC-USD`),
opened by tapping a row, a mover, the scrolling ticker under the menu, or the search button (🔍) in the menu bar.

Stocks and coins are added from the site itself (Add buttons on the Top 10, the Add-a-ticker and Add-a-coin
boxes, and each ticker's page), stored in a free Supabase database with email sign-in. See *Hosted watchlist*
below.

## Install as an app

The site installs like an app on a phone, tablet or computer and opens to the last saved data when offline.

- **iPhone / iPad (Safari):** tap **Install app** in the menu bar (or Share), then **Add to Home Screen**.
- **Android / Chrome / Edge:** tap **Install app** in the menu bar, or *Install app* in the browser menu.

`manifest.webmanifest` sets the name, icons (`icons/`) and colors; `sw.js` keeps a copy of each page and data
file it loads, always trying the network first so updates show up straight away.

## Layout

```
config.json              tickers, watchlist, crypto, macro, pages + cards, fetchers, API limits
index.html, styles.css   page shell and styles
manifest.webmanifest     app name, icons and colors for installing; sw.js keeps it working offline
js/main.js               loads config + data, builds the menu, mounts the current page's cards
js/core.js               the `ctx` every card gets: data helpers and shared state
js/lib/                  formatting and chart helpers; db.js talks to the hosted watchlist
js/cards/*.js            one file per card type
scripts/update.py        runs every enabled fetcher, writes data/<name>.json
scripts/yahoo_client.py  Yahoo Finance daily prices (main price source, no key or daily limit)
scripts/av_client.py     shared Alpha Vantage client, used as backup (rate limit + daily budget)
scripts/fetchers/*.py    one file per kind of data (prices, smallcaps = Russell 2000 top gainers,
                         picks = technical signals)
supabase/setup.sql       one-time database setup for the hosted watchlist
supabase/push.sql        one-time setup for notifications; supabase/functions/notify-picks sends them
supabase/alerts-positions.sql  private price alerts and positions (one row set per signed-in person)
supabase/functions/request-update  starts a prices-only update when an editor adds a stock or coin
supabase/functions/quote  delayed intraday quotes for ticker pages (Yahoo, cached 60 s)
data/                    fetcher output, committed by the workflow
.github/workflows/       daily "Update data" job
```

## Setup (one time)

1. **Prices** come from Yahoo Finance, which needs no key and has no daily limit, so the watchlist can be
   as long as you like. Optional backup: a free Alpha Vantage key from
   <https://www.alphavantage.co/support/#api-key>, saved as the repository secret `ALPHAVANTAGE_API_KEY`
   (*Settings → Secrets and variables → Actions*). It's used only for tickers Yahoo doesn't return.
   Change the order in `config.json` → `api.priceSources`.
2. **Pages** — *Settings → Pages*: deploy from branch **main**, folder **/ (root)**.
3. **Data** — *Actions → Update data → Run workflow*. After that it runs Mon–Fri at 22:20 UTC (6:20pm
   Eastern in summer, 5:20pm in winter), plus a prices-and-signals run Saturday and Sunday at 14:20 UTC for
   coins. Each run also checks the site (`scripts/check_site.py`) and stops before committing if a page would
   break.

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

The daily job reads the hosted list too, so stocks and coins you add get price history from the next run.
Coins are stored as Yahoo pairs (`SOL-USD`) and shown on the Crypto page. The list is capped at 50 entries.

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

Watchlist, index and coin prices come from their full history in `data/prices.json`. For the rest, the fetcher
keeps 60 days of Russell 2000 closes in `data/picks-history.json` (about 800 KB, not loaded by the page). Each
run adds that day's iShares holdings file; while the history is shorter than 60 days, it also downloads about
4 months of daily closes for every Russell 2000 stock from Yahoo in one batch (`yfinance`), so picks don't wait
weeks for history to build. iShares doesn't serve older holdings files, so that older fallback is off
(`"backfill": false`).

If you set up the hosted watchlist before the Picks page existed, run `supabase/allow-picks-source.sql` once in
the SQL Editor so stocks can be added from it.

## Notifications for new picks

Tap **🔔 Notify me** on the Picks page to get a notification when the daily update brings stocks that weren't
picks the day before. It needs a sign-in (any email) and, on iPhone and iPad, the installed app (iOS 16.4+).
**Send test** checks the whole path to your device; **Turn off** stops it on that device.

How it works: the browser subscribes with the standard Web Push API and saves the subscription in Supabase.
Every 15 minutes `pg_cron` calls the `notify-picks` Edge Function, which reads `data/picks.json` from GitHub and
sends a notification only when the file's date is newer than the last one it handled, so it never sends twice.
Its signing keys are generated on its first run and stay in the database; nothing is stored in GitHub.

One-time setup (until it's done the Notify button stays hidden):

1. **SQL Editor:** paste `supabase/push.sql`, replace `YOUR-PROJECT` and `YOUR-ANON-KEY`, and **Run**.
2. **Edge Functions → Deploy a new function:** name it `notify-picks` and paste
   `supabase/functions/notify-picks/index.ts` (or `supabase functions deploy notify-picks` with the CLI).
3. Wait for the next 15-minute run (or call the function once) so it creates its keys.

## Earnings dates

`scripts/fetchers/earnings.py` saves the next report date for Russell 2000 and watchlist stocks in
`data/earnings.json`. With an Alpha Vantage key it's one call a day (`EARNINGS_CALENDAR`, every US company for
the next 3 months); without one it asks Yahoo about the stocks on screen (watchlist, picks, top 10). Tables
show an "Earnings Nov 5" chip for reports within 14 days (orange within 3), and ticker pages show the date.

## Breadth, sectors, news and live quotes

- **Breadth** (`scripts/fetchers/breadth.py`, after picks): from the Russell 2000 history picks keeps, the daily
  count of rising and falling stocks, the share above their 20- and 50-day averages, and new 20-day highs and
  lows. No downloads.
- **Sectors**: each sector's median 1-day, 1-week and 1-month return and its biggest movers today, shown as a
  shaded map on Overview. Same file, same run.
- **News** (`scripts/fetchers/news.py`): up to 5 headlines from the last 14 days per stock or coin on your lists,
  picks and top 10, from Yahoo. Shown on each ticker and coin page.
- **Live quote**: ticker and coin pages show a "Now" price during market hours (stocks about 15 minutes delayed,
  coins near real time), refreshed every minute, from the `quote` Edge Function.
- **CSV**: every table and Positions has a CSV link that downloads what's on screen.

## Price alerts, positions and reminders

Signed-in people (any email) can keep private **price alerts** and **positions**; nobody else can read them.

- **Alerts**: "closes above $X" or "closes below $Y" (fire once, then turn off), or "moves at least N% in a
  day" (at most once a day). Set them on any ticker or coin page, or on Portfolio. They're checked against
  each new `data/prices.json`, so after the evening update (and weekend coin runs).
- **Positions**: shares and average cost per stock or coin. Portfolio shows value, day change, total gain and
  weight. A position in something no list tracks is added to the watchlist or Crypto (editors) so it gets prices.
- **Earnings reminders**: around 6pm New York time the evening before, for watchlist stocks and your own
  positions reporting the next trading day (Friday evening covers Monday).

All three arrive as push notifications from `notify-picks`, the same function that announces new picks; turn
notifications on from the Picks or Portfolio page. Setup: run `supabase/alerts-positions.sql` once, then deploy
the updated `supabase/functions/notify-picks`.

## Prices right after adding a stock (optional)

By default a newly added stock or coin gets prices at the next scheduled update. To fetch them within about
2 minutes instead:

1. GitHub → *Settings → Developer settings → Fine-grained tokens → Generate new token*: repository
   access **Only select repositories → Trader**, permission **Actions: Read and write**. Copy the token.
2. Supabase → *Edge Functions → Secrets*: add `GITHUB_DISPATCH_TOKEN` with that token.
3. Deploy `supabase/functions/request-update` (already deployed for this site).

The site calls it after an editor adds something; it asks GitHub at most once a minute.

## Common changes (config only)

**Watchlist in config.json** — besides the hosted list, stocks can be pinned in `watchlist`. `added` (the
day you started watching) adds a "Since added" column; `note` shows beside it and on the stock's page.
These can't be removed from the site.

```json
"watchlist": [
  { "symbol": "CROX", "name": "Crocs", "added": "2026-10-24", "note": "Watching for a turn in margins" }
]
```

Prices come from Yahoo with no daily limit, so the watchlist can be as long as you like. Anything that fails
to download is noted in the page footer.

**Crypto** — `crypto` lists the coins pinned on the Crypto page (Yahoo pairs such as `BTC-USD`). Coins
trade every day, so their pages count periods in calendar days (1M = 30 days) instead of trading days.

**Macro backdrop** — `macro` lists the series on the Overview's macro card: `kind` is `"yield"` (moves shown
in basis points) or `"level"` (moves in %), `hint` a line under the tile. Rises show red there, since higher
yields, VIX or dollar are headwinds for small caps.

**Index tickers** — add to `tickers`. They appear on the Overview chart and table.

**Menu and pages** — each entry in `pages` is a menu item, in order:

```json
{ "id": "sectors", "title": "Sectors", "heading": "Sector ETFs", "cards": [ ... ] }
```

`id` is the address (`#sectors`), `title` the menu label, `heading` the page title (default: `title`).
`"hidden": true` keeps a page out of the menu (the ticker page works this way); `"ranges": false` hides
the period buttons on that page; `"calendar": "crypto"` counts periods in calendar days.

**Rearrange or remove cards** — reorder or delete entries in a page's `cards`. `"width"` is `"full"` or
`"half"`.

**Reuse a card with different tickers** — the built-in cards take options. Anywhere a symbol is expected
you can write `$primary`, `$benchmark`, or `$route` (the ticker in the address, on the ticker page).

| Card | Options |
|---|---|
| `macro` | `title`, `note`, `days` (trend line length) — tiles for each series in `config.macro` |
| `headline` | `a`, `b`, `aName`, `bName` (defaults: `primary` vs `benchmark`). Renders as the page heading. |
| `performance` | `title`, `note`, `list` (`tickers`, `watchlist` or `crypto`) or `symbols: [...]`, `highlight: [...]` (`[]` = all bold) |
| `spread` | `title`, `note`, `a`, `b` — return of `a` minus return of `b` |
| `pair` | `title`, `note`, `series: [{symbol, label}, {symbol, label}]` |
| `table` | `title`, `note`, `list`, `columns: [{key, label, days}]`, `sparkDays`, `editable` (Edit list link) |
| `movers` | `title`, `note`, `list` (default `watchlist`), `days` (1 = today), `count` per side |
| `ticker` | `symbol` (default `$route`) — key figures, price chart, and Add/Remove watchlist button |
| `topgainers` | `title`, `note`, `count` (default 10) — the day's top Russell 2000 gainers with Add buttons |
| `breadth` | `title`, `note` — Russell 2000 breadth stats and the share above the 20- and 50-day averages |
| `sectors` | `title`, `note` — sector map with 1D / 1W / 1M; tap a sector for its movers |
| `news` | `symbol` (default `$route`), `title`, `count` — latest headlines |
| `alerts` | `title`, `note`, `symbol` (`$route` on ticker pages; leave out for all your alerts) — set and list price alerts |
| `positions` | `title`, `note` — your holdings: value, day change, gain, weight; add, edit (tap a row) and remove |
| `addticker` | `title`, `note`, `list` (`crypto` for the coin version) — add to the hosted list, with suggestions |
| `picks` | `title`, `note`, `list` (`picks`, `cautions`, `watchlist`, `crypto` or `tickers`), `count` — technical signals with scores |
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

**Alpha Vantage budget.** Alpha Vantage is only a backup now. Its free tier allows 25 calls a day and 5 a
minute (`api.dailyBudget`, `api.minIntervalSeconds`); it's used only for stocks Yahoo doesn't return, never
for coins or indexes. Fetchers run in the order listed.

## Run locally

```sh
pip install yfinance
python scripts/update.py                  # all fetchers (add ALPHAVANTAGE_API_KEY=xxx for the backup)
python scripts/update.py smallcaps        # just one
python scripts/check_site.py              # the same checks the workflow runs
python -m http.server 8000                # then open http://localhost:8000
```
