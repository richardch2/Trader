// Daily top gainers among Russell 2000 stocks (from data/smallcaps.json), each
// with a button to add it to the hosted watchlist.
// Options: title, note, count (default 10)
import { cardHead, h } from "../core.js";
import { pct, money, tone, date } from "../lib/format.js";

export default function topgainers(opts, ctx) {
  const data = ctx.data.smallcaps;
  const count = opts.count || 10;
  let body, noteEl;

  return {
    mount(el) {
      const head = cardHead(el, opts.title || "Top 10 small caps today", " ");
      noteEl = head.note;
      body = h("div", "table-wrap");
      el.append(body);
    },
    render() {
      const rows = (data?.gainers || []).slice(0, count);
      const when = data?.asOf ? date(data.asOf, { weekday: "short", month: "short", day: "numeric" }) : null;
      noteEl.textContent = opts.note || (
        !data ? "Russell 2000 rankings arrive with the next daily update."
        : data.source === "holdings"
          ? `Russell 2000 stocks up the most on ${when}${data.prevAsOf ? ` (vs ${date(data.prevAsOf)})` : ""}. Under $1 excluded.`
          : `Russell 2000 stocks among the whole market's top gainers on ${when}. The full ranking starts with the next daily update.`
      );
      body.replaceChildren();
      if (!rows.length) {
        body.append(h("p", "card-empty", data?.count
          ? `Tracking all ${data.count.toLocaleString()} Russell 2000 stocks. The first full top 10 appears after the next daily update.`
          : "No ranking yet."));
        return;
      }

      const showAction = ctx.db.enabled;
      const table = document.createElement("table");
      table.className = "linked";
      const head = document.createElement("tr");
      for (const [label, cls] of [["#", "rank"], ["Ticker"], ["Name", "left hide-sm"], ["Sector", "left hide-md"], ["Price"], ["Change"], ...(showAction ? [["", "action"]] : [])]) {
        head.append(h("th", cls, label));
      }
      table.createTHead().append(head);
      const tbody = table.createTBody();
      rows.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.dataset.sym = r.symbol;
        const sym = h("td", "sym");
        const a = h("a", null, r.symbol); a.href = ctx.href(r.symbol);
        sym.append(a);
        tr.append(h("td", "rank muted", String(i + 1)), sym, h("td", "name left hide-sm", r.name), h("td", "muted left hide-md", r.sector),
          h("td", null, money(r.price)), h("td", tone(r.change), pct(r.change)));
        if (showAction) tr.append(actionCell(r));
        tbody.append(tr);
      });
      table.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
      });
      body.append(table);
    },
  };

  function actionCell(r) {
    const td = h("td", "action");
    if (ctx.onWatchlist(r.symbol)) {
      td.append(h("span", "watching", "✓ Watching"));
    } else if (ctx.db.canEdit) {
      const b = h("button", "btn small", "+ Add");
      b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "Adding…";
        try { await ctx.addToWatchlist({ symbol: r.symbol, name: r.name, source: "top10" }); }
        catch (e) { ctx.toast(e.message, true); b.disabled = false; b.textContent = "+ Add"; }
      });
      td.append(b);
    } else {
      const s = h("span", "muted small-text", ctx.db.email ? "View only" : "Sign in to add");
      td.append(s);
    }
    return td;
  }
}
