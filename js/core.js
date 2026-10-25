// The context every card receives: config, raw datasets, price helpers and shared state.
//
// Cards should read data through these helpers rather than the raw files, so a
// change to how data is stored only needs fixing here.

export const RANGES = [
  { id: "1M", days: 21, word: "past month" },
  { id: "3M", days: 63, word: "past three months" },
  { id: "6M", days: 126, word: "past six months" },
  { id: "1Y", days: 252, word: "past year" },
  { id: "All", days: Infinity, word: "full period" },
];

const PALETTE = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];

/** Coins are Yahoo pairs against the dollar, e.g. BTC-USD. */
export const isCrypto = (sym) => /-USD$/.test(sym || "");

/** Crypto trades every day, so its periods are calendar days: 1M = 30, 3M = 91, 1Y = 365. */
const calendarDays = (r) => Math.round((r.days * 365) / 252);
const minusDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);

export function createContext(config, datasets) {
  const lists = {
    tickers: config.tickers || [],
    watchlist: config.watchlist || [],
    crypto: config.crypto || [],
    macro: config.macro || [],
  };
  const macroSyms = new Set(lists.macro.map((m) => m.symbol));
  const everyone = [];
  for (const t of [...lists.tickers, ...lists.watchlist, ...lists.crypto, ...lists.macro]) {
    if (!everyone.some((e) => e.symbol === t.symbol)) everyone.push(t);
  }

  const prices = datasets.prices?.series || {};
  const closes = {};
  const allDates = new Set(), coinDates = new Set();
  for (const t of everyone) {
    const s = prices[t.symbol] || {};
    closes[t.symbol] = new Map(Object.entries(s).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, b]) => [d, b.c]));
    // weekends would shorten the stock periods, so coins keep a calendar of their own
    // macro series (bond market days differ) don't add days to the stock calendar either
    if (macroSyms.has(t.symbol)) continue;
    Object.keys(s).forEach((d) => (isCrypto(t.symbol) ? coinDates : allDates).add(d));
  }
  const dates = [...allDates].sort();
  const cryptoDates = [...coinDates].sort();
  const benchmark = config.benchmark;

  // colors are assigned per list, so each page's chart uses the full palette
  const colors = {};
  for (const list of Object.values(lists)) {
    let i = 0;
    for (const t of list) colors[t.symbol] ??= t.symbol === benchmark ? "--bench" : PALETTE[i++ % PALETTE.length];
  }

  const listeners = new Set();

  const ctx = {
    config,
    /** Raw output of each fetcher, keyed by fetcher name (data/<name>.json). */
    data: datasets,
    /** The index ETFs from config.json (the overview list). */
    tickers: lists.tickers,
    watchlist: lists.watchlist,
    /** A named list: "tickers", "watchlist", "crypto" or "macro". */
    list: (name = "tickers") => lists[name] || [],
    primary: config.primary,
    benchmark,
    /** Every trading day with data for any stock or ETF, oldest first. */
    dates,
    /** Every day with data for any coin (crypto trades seven days a week). */
    cryptoDates,
    /** Which calendar the selected period counts in: "stocks" or "crypto". Set per page. */
    calendar: "stocks",
    /** Last day with data in the current calendar. */
    lastDate: () => (ctx.calendar === "crypto" ? cryptoDates : dates).at(-1),
    /** The current page and its argument, e.g. {page: "ticker", arg: "IWM"} for #ticker/IWM. */
    route: { page: null, arg: null },

    /** Shared, page-wide state. Change it with ctx.set(); every card re-renders. */
    state: { range: config.defaultRange || "3M" },
    set(patch) {
      Object.assign(ctx.state, patch);
      listeners.forEach((fn) => fn(ctx.state));
    },
    onChange(fn) { listeners.add(fn); },

    /**
     * Resolve a symbol from card options. Besides plain symbols, accepts
     * "$primary", "$benchmark" and "$route" (the ticker in the page address).
     */
    resolve(sym) {
      if (sym === "$primary") return ctx.primary;
      if (sym === "$benchmark") return ctx.benchmark;
      if (sym === "$route") return ctx.route.arg;
      return sym;
    },
    ticker: (sym) => everyone.find((t) => t.symbol === sym),
    color: (sym) => colors[sym] || "--muted",
    /** Yields, VIX and the like: shown, never added to a list. */
    isMacro: (sym) => macroSyms.has(sym),
    has: (sym) => (closes[sym]?.size || 0) > 0,
    /** Link to a ticker's detail page. */
    href: (sym) => `#${isCrypto(sym) ? "coin" : "ticker"}/${encodeURIComponent(sym)}`,

    /** Raw daily bars {o,h,l,c,v} keyed by date. */
    bars: (sym) => prices[sym] || {},
    /** [{d, c}] of daily closes for a ticker, oldest first. */
    series(sym) {
      const m = closes[sym] || new Map();
      return [...m].map(([d, c]) => ({ d, c }));
    },
    lastClose: (sym) => ctx.series(sym).at(-1)?.c ?? null,

    /** Return over the last n trading days, or null if there isn't enough history. */
    ret(sym, n) {
      const s = ctx.series(sym);
      return s.length > n ? s.at(-1).c / s.at(-1 - n).c - 1 : null;
    },
    /** Return since a date (first close on or after it), or null if no data then. */
    retSince(sym, day) {
      const s = ctx.series(sym);
      const start = s.find((p) => p.d >= day);
      return start && s.length ? s.at(-1).c / start.c - 1 : null;
    },

    range: () => RANGES.find((r) => r.id === ctx.state.range) || RANGES[1],
    rangeAvailable(r) {
      if (r.days === Infinity) return true;
      if (ctx.calendar !== "crypto") return dates.length > r.days;
      return cryptoDates.length > 1 && cryptoDates[0] <= minusDays(cryptoDates.at(-1), calendarDays(r) - 3);
    },
    /** Dates in the selected period. */
    window() {
      const r = ctx.range();
      if (ctx.calendar === "crypto") {
        if (r.days === Infinity || !cryptoDates.length) return cryptoDates;
        const from = minusDays(cryptoDates.at(-1), calendarDays(r));
        return cryptoDates.filter((d) => d >= from);
      }
      return r.days === Infinity ? dates : dates.slice(-(r.days + 1));
    },
    /** Change since the start of the selected period: [{d, v}] with v = 0.05 for +5%. */
    rebased(sym, win = ctx.window()) {
      const m = closes[sym] || new Map();
      const pts = win.filter((d) => m.has(d));
      if (!pts.length) return [];
      const base = m.get(pts[0]);
      return pts.map((d) => ({ d, v: m.get(d) / base - 1 }));
    },
    /** Difference between two tickers' rebased returns, day by day. */
    spread(a, b, win = ctx.window()) {
      const A = new Map(ctx.rebased(a, win).map((p) => [p.d, p.v]));
      return ctx.rebased(b, win).filter((p) => A.has(p.d)).map((p) => ({ d: p.d, v: A.get(p.d) - p.v }));
    },
  };

  // fall back to the longest period the data supports
  if (!ctx.rangeAvailable(ctx.range())) {
    const ok = RANGES.filter(ctx.rangeAvailable);
    ctx.state.range = ok.at(-2)?.id || "All";
  }
  return ctx;
}

/** Standard card heading: title, one-line note, and a slot for controls or links on the right. */
export function cardHead(el, title, note) {
  const head = document.createElement("div");
  head.className = "card-head";
  const left = document.createElement("div");
  const h2 = document.createElement("h2"); h2.textContent = title || "";
  left.append(h2);
  if (note) { const p = document.createElement("p"); p.className = "note"; p.textContent = note; left.append(p); }
  const right = document.createElement("div"); right.className = "card-tools";
  head.append(left, right);
  el.append(head);
  return { head, title: h2, note: left.querySelector(".note"), tools: right };
}

const DAY = 864e5;
const todayISO = () => {   // today in New York, where the market keeps its calendar
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
};

/** Next earnings report for a stock: {date, time, estimate, days} or null (none known, or already past). */
export function nextEarnings(ctx, sym) {
  const e = ctx.data.earnings?.dates?.[sym];
  if (!e?.date) return null;
  const days = Math.round((Date.parse(e.date) - Date.parse(todayISO())) / DAY);
  return days < 0 ? null : { ...e, days };
}

/** "Earnings Nov 5" chip for a stock reporting within `within` days, else null. */
export function earningsBadge(ctx, sym, within = 14) {
  const e = nextEarnings(ctx, sym);
  if (!e || e.days > within) return null;
  const when = e.days === 0 ? "today" : e.days === 1 ? "tomorrow"
    : new Date(e.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const b = h("span", "earn-badge" + (e.days <= 3 ? " soon" : ""), `Earnings ${when}`);
  b.title = `Reports ${e.date}${e.time ? ` (${e.time})` : ""}${e.estimate != null ? `, EPS estimate ${e.estimate}` : ""}`;
  return b;
}

/** Shorthand for creating an HTML element with a class and text. */
export function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Link to edit config.json on GitHub, if the repo is known. */
export function editLink(ctx, label = "Edit list") {
  const repo = ctx.config.repo;
  if (!repo) return null;
  const a = h("a", "tool-link", label);
  a.href = `https://github.com/${repo}/edit/main/config.json`;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

/**
 * Table cell with "+ Add" to the hosted watchlist, "✓ Watching" if already there, or a
 * sign-in hint. item: {symbol, name}; source says where it was added from.
 */
export function addCell(ctx, item, source) {
  const td = h("td", "action");
  if (ctx.onWatchlist(item.symbol)) {
    td.append(h("span", "watching", "✓ Watching"));
  } else if (ctx.db.canEdit) {
    const b = h("button", "btn small", "+ Add");
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Adding…";
      try { await ctx.addToWatchlist({ symbol: item.symbol, name: item.name, source }); }
      catch (e) { ctx.toast(e.message, true); b.disabled = false; b.textContent = "+ Add"; }
    });
    td.append(b);
  } else {
    td.append(h("span", "muted small-text", ctx.db.email ? "View only" : "Sign in to add"));
  }
  return td;
}
