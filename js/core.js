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

export function createContext(config, datasets) {
  const lists = {
    tickers: config.tickers || [],
    watchlist: config.watchlist || [],
  };
  const everyone = [...lists.tickers, ...lists.watchlist.filter((w) => !lists.tickers.some((t) => t.symbol === w.symbol))];

  const prices = datasets.prices?.series || {};
  const closes = {};
  const allDates = new Set();
  for (const t of everyone) {
    const s = prices[t.symbol] || {};
    closes[t.symbol] = new Map(Object.entries(s).map(([d, b]) => [d, b.c]));
    Object.keys(s).forEach((d) => allDates.add(d));
  }
  const dates = [...allDates].sort();
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
    /** A named list: "tickers" or "watchlist". */
    list: (name = "tickers") => lists[name] || [],
    primary: config.primary,
    benchmark,
    /** Every trading day with data for any ticker, oldest first. */
    dates,
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
    has: (sym) => (closes[sym]?.size || 0) > 0,
    /** Link to a ticker's detail page. */
    href: (sym) => `#ticker/${encodeURIComponent(sym)}`,

    /** Raw daily bars {o,h,l,c,v} keyed by date. */
    bars: (sym) => prices[sym] || {},
    /** [{d, c}] of daily closes for a ticker, oldest first. */
    series(sym) {
      const m = closes[sym] || new Map();
      return dates.filter((d) => m.has(d)).map((d) => ({ d, c: m.get(d) }));
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
    rangeAvailable: (r) => r.days === Infinity || dates.length > r.days,
    /** Dates in the selected period. */
    window() {
      const r = ctx.range();
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
