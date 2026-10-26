// Daily top gainers among Russell 2000 stocks (from data/smallcaps.json), each
// with a button to add it to the hosted watchlist.
// Options: title, note, count (default 10), band ("low" = only $1-$5 stocks),
// filter (true: an All / $1-$5 switch on the card, remembered on this device)
import { cardHead, h, addCell, earningsBadge } from "../core.js";
import { pct, money, tone, date } from "../lib/format.js";

export default function topgainers(opts, ctx) {
  const data = ctx.data.smallcaps;
  const count = opts.count || 10;
  let body, noteEl, seg;
  let band = opts.band || "all";
  if (opts.filter) { try { band = localStorage.getItem("top10-band") || band; } catch {} }

  return {
    mount(el) {
      const head = cardHead(el, opts.title || "Top 10 small caps today", " ");
      noteEl = head.note;
      if (opts.filter) {
        seg = h("div", "ranges seg");
        for (const [id, label] of [["all", "All"], ["low", "$1–$5"]]) {
          const b = h("button", null, label);
          b.dataset.band = id;
          b.addEventListener("click", () => {
            band = id;
            try { localStorage.setItem("top10-band", id); } catch {}
            this.render();
          });
          seg.append(b);
        }
        head.tools.append(seg);
      }
      body = h("div", "table-wrap");
      el.append(body);
    },
    render() {
      const low = band === "low";
      seg?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.band === band)));
      const rows = ((low ? data?.gainersLow : data?.gainers) || []).slice(0, count);
      const day = data?.rankedAsOf || data?.asOf;
      const when = day ? date(day, { weekday: "short", month: "short", day: "numeric" }) : null;
      noteEl.textContent = opts.note || (
        !data ? "Russell 2000 rankings arrive with the next daily update."
        : data.source === "holdings" || data.source === "history"
          ? `Russell 2000 stocks${low ? " priced $1 to $5" : ""} up the most on ${when}${data.prevAsOf ? ` (vs ${date(data.prevAsOf)})` : ""}.${low ? "" : " Under $1 excluded."}`
          : `Russell 2000 stocks among the whole market's top gainers on ${when}. The full ranking starts with the next daily update.`
      );
      body.replaceChildren();
      if (!rows.length) {
        body.append(h("p", "card-empty", low && data?.gainers?.length
          ? "No $1–$5 stocks among the gainers yet. The list fills with the next daily update."
          : data?.count
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
        const eb = earningsBadge(ctx, r.symbol); if (eb) sym.append(eb);
        tr.append(h("td", "rank muted", String(i + 1)), sym, h("td", "name left hide-sm", r.name), h("td", "muted left hide-md", r.sector),
          h("td", null, money(r.price)), h("td", tone(r.change), pct(r.change)));
        if (showAction) tr.append(addCell(ctx, r, "top10"));
        tbody.append(tr);
      });
      table.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
      });
      body.append(table);
    },
  };
}
