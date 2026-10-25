// Trending ticker: a strip under the menu bar that scrolls the day's moves.
// It shows today's Russell 2000 top gainers (when the latest update found any),
// then every tracked ticker and watchlist stock, biggest moves first. Each item
// links to its ticker page. Hovering or touching pauses it; with reduced motion
// turned on it stays still and scrolls sideways by hand instead.
import { h } from "../core.js";
import { pct, money, tone } from "./format.js";

const MAX_GAINERS = 10;
const PX_PER_SECOND = 40;

/** Items for the strip: [{symbol, price, change, hot}] with change as 0.05 for +5%. */
function trending(ctx) {
  const items = [];
  const seen = new Set();
  for (const g of (ctx.data.smallcaps?.gainers || []).slice(0, MAX_GAINERS)) {
    if (g.change == null || seen.has(g.symbol)) continue;
    seen.add(g.symbol);
    items.push({ symbol: g.symbol, price: g.price, change: g.change, hot: true });
  }
  const tracked = [];
  for (const t of [...ctx.tickers, ...ctx.watchlist]) {
    if (seen.has(t.symbol) || !ctx.has(t.symbol)) continue;
    seen.add(t.symbol);
    tracked.push(t);
  }
  const moves = tracked
    .map((t) => ({ symbol: t.symbol, price: ctx.lastClose(t.symbol), change: ctx.ret(t.symbol, 1) }))
    .filter((t) => t.change != null)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return [...items, ...moves];
}

function itemEl(ctx, it) {
  const a = h("a", "tape-item");
  a.href = ctx.href(it.symbol);
  if (it.hot) a.append(h("span", "tape-hot", "▲"));
  a.append(h("span", "tape-sym", it.symbol), h("span", "tape-px", money(it.price)), h("span", tone(it.change), pct(it.change)));
  return a;
}

/** Fill (or refill) the #tape strip. Safe to call again after the watchlist changes. */
export function renderTape(ctx) {
  const tape = document.getElementById("tape");
  if (!tape) return;
  const items = trending(ctx);
  tape.hidden = !items.length;
  if (!items.length) return;

  const track = h("div", "tape-track");
  const group = () => {
    const g = h("div", "tape-group");
    g.append(...items.map((it) => itemEl(ctx, it)));
    return g;
  };
  // two copies side by side, so the loop is seamless
  const first = group(), second = group();
  second.setAttribute("aria-hidden", "true");
  second.querySelectorAll("a").forEach((a) => (a.tabIndex = -1));
  track.append(first, second);
  tape.replaceChildren(track);

  // same speed whatever the number of items
  requestAnimationFrame(() => {
    track.style.setProperty("--tape-duration", `${Math.max(20, first.scrollWidth / PX_PER_SECOND)}s`);
  });
}
