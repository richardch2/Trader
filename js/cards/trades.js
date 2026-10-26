// Trade history (supabase/trades.sql): every buy and sale recorded from the Positions card,
// realized gains on sales (against the average cost at the time), and totals for all time
// and this year. Private to the signed-in person.
// Options: title, note
import { cardHead, h } from "../core.js";
import { pct, tone, date } from "../lib/format.js";
import { csvLink } from "../lib/csv.js";
import { signedUsd, exact, qty } from "./positions.js";

export default function trades(opts, ctx) {
  let stats, wrap;
  const year = String(new Date().getFullYear());

  function summary(list) {
    const sells = list.filter((t) => t.side === "sell" && t.realized != null);
    const sum = (xs) => xs.reduce((s, t) => s + Number(t.realized), 0);
    const ytd = sells.filter((t) => t.traded_on.startsWith(year));
    const wins = sells.filter((t) => Number(t.realized) > 0).length;
    const items = [
      ["Realized gain", signedUsd(sum(sells)), `${sells.length} sale${sells.length === 1 ? "" : "s"}`, sum(sells)],
      [`${year} so far`, signedUsd(sum(ytd)), `${ytd.length} sale${ytd.length === 1 ? "" : "s"}`, sum(ytd)],
      ["Winning sales", sells.length ? `${Math.round((wins / sells.length) * 100)}%` : "—", sells.length ? `${wins} of ${sells.length}` : null],
      ["Trades", list.length.toLocaleString(), `${list.length - sells.length} buys`],
    ];
    stats.replaceChildren(...items.map(([label, v, sub, signed]) => {
      const s = h("div", "stat");
      s.append(h("div", "stat-label", label), h("div", "stat-value " + (signed != null ? tone(signed) : ""), v));
      if (sub) s.append(h("div", "stat-sub", sub));
      return s;
    }));
  }

  function table(list) {
    const tbl = document.createElement("table");
    tbl.className = "linked";
    const head = document.createElement("tr");
    for (const [label, cls] of [["Date", "left"], ["Symbol"], ["Side", "left"], ["Shares"], ["Price"], ["Realized"], ["", "action"]]) {
      head.append(h("th", cls || null, label));
    }
    tbl.createTHead().append(head);
    const body = tbl.createTBody();
    for (const t of list.slice(0, 200)) {
      const tr = document.createElement("tr");
      tr.dataset.sym = t.symbol;
      const sym = h("td", "sym");
      const a = h("a", null, t.symbol); a.href = ctx.href(t.symbol);
      sym.append(a);
      const gain = h("td", t.side === "sell" ? tone(Number(t.realized)) : "muted");
      if (t.side === "sell" && t.realized != null) {
        const basis = Number(t.cost_basis) * Number(t.shares);
        gain.append(signedUsd(Number(t.realized)), h("div", "cell-sub", basis > 0 ? pct(Number(t.realized) / basis) : ""));
        gain.title = `Average cost ${exact(Number(t.cost_basis))} a share`;
      } else gain.textContent = "—";
      const del = h("button", "link-btn", "✕");
      del.title = "Delete this record";
      del.setAttribute("aria-label", `Delete ${t.side} of ${t.symbol} on ${t.traded_on}`);
      del.addEventListener("click", async () => {
        if (!confirm(`Delete this ${t.side} of ${qty(t.shares)} ${t.symbol}? Only the record goes; your position stays as it is.`)) return;
        del.disabled = true;
        try { await ctx.changePrivate((db) => db.removeTrade(t.id), "Trade record deleted."); }
        catch (e) { ctx.toast(e.message, true); del.disabled = false; }
      });
      const act = h("td", "action"); act.append(del);
      tr.append(h("td", "left muted", date(t.traded_on, { month: "short", day: "numeric", year: "2-digit" })), sym,
        h("td", "left " + (t.side === "sell" ? "neg" : "pos"), t.side === "sell" ? "Sell" : "Buy"),
        h("td", null, qty(t.shares)), h("td", null, exact(Number(t.price))), gain, act);
      body.append(tr);
    }
    tbl.addEventListener("click", (ev) => {
      const row = ev.target.closest("tr[data-sym]");
      if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
    });
    const w = h("div", "table-wrap");
    w.append(tbl);
    return w;
  }

  return {
    mount(el) {
      if (!ctx.db.enabled) { el.hidden = true; return; }
      const { tools } = cardHead(el, opts.title || "Trade history",
        opts.note || "Buys and sales you record on a position. Gains on sales are against your average cost. Only you can see them.");
      tools.append(csvLink("trades", () => [
        ["Date", "Symbol", "Side", "Shares", "Price", "Avg cost", "Realized $"],
        ...(ctx.trades || []).map((t) => [t.traded_on, t.symbol, t.side, Number(t.shares), Number(t.price),
          t.cost_basis == null ? "" : Number(t.cost_basis), t.realized == null ? "" : +Number(t.realized).toFixed(2)]),
      ]));
      stats = h("div", "stats");
      wrap = h("div");
      el.append(stats, wrap);
    },
    render() {
      if (!stats) return;
      const list = ctx.trades || [];
      stats.hidden = !ctx.db.email || !list.length;
      if (!ctx.db.email) { wrap.replaceChildren(h("p", "card-empty", "Sign in to keep a history of your trades.")); return; }
      if (!list.length) {
        wrap.replaceChildren(h("p", "card-empty", "No trades yet. Tap a position above and use Buy more or Sell, and each trade lands here with its realized gain."));
        return;
      }
      summary(list);
      wrap.replaceChildren(table(list));
    },
  };
}
