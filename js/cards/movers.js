// Biggest gainers and losers in a list over a number of trading days.
// Options: title, note, list ("watchlist" default), days (default 1), count (default 3)
import { cardHead, h } from "../core.js";
import { pct, money, tone } from "../lib/format.js";

const PERIOD = { 1: "today", 5: "this week", 7: "this week", 21: "this month", 30: "this month" };

export default function movers(opts, ctx) {
  const items = ctx.list(opts.list || "watchlist");
  const days = opts.days || 1;
  const count = opts.count || 3;
  let body;

  return {
    mount(el) {
      cardHead(el, opts.title || "Biggest moves", opts.note || `Largest price changes ${PERIOD[days] || `over ${days} days`}.`);
      body = h("div", "movers");
      el.append(body);
    },
    render() {
      const moves = items
        .map((t) => ({ t, r: ctx.ret(t.symbol, days) }))
        .filter((m) => m.r != null)
        .sort((a, b) => b.r - a.r);
      body.replaceChildren();
      if (!moves.length) { body.append(h("p", "card-empty", "No moves to show yet.")); return; }
      const up = moves.filter((m) => m.r > 0).slice(0, count);
      const down = moves.filter((m) => m.r < 0).slice(-count).reverse();
      for (const [label, group] of [["Up", up], ["Down", down]]) {
        const col = h("div", "movers-col");
        col.append(h("h3", null, label));
        if (!group.length) col.append(h("p", "muted", "None"));
        for (const { t, r } of group) {
          const a = h("a", "mover");
          a.href = ctx.href(t.symbol);
          a.append(h("span", "sym", t.symbol), h("span", "muted", money(ctx.lastClose(t.symbol))), h("span", tone(r), pct(r)));
          col.append(a);
        }
        body.append(col);
      }
    },
  };
}
