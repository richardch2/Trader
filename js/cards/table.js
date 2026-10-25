// Sortable table of a list of tickers. Tap a row to open that ticker's page.
// Options: title, note,
//   list      – "tickers" (default), "watchlist" or "crypto"
//   columns   – return periods: [{key, label, days}] (default 1D, 1W, 1M, 3M)
//   sparkDays – trading days in the trend line (default 63)
//   editable  – show an "Edit list" link to config.json on GitHub (needs "repo" in config)
// Watchlist entries may carry "added" (YYYY-MM-DD) and "note"; those columns appear when present.
import { cardHead, h, editLink, earningsBadge } from "../core.js";
import { sparkline } from "../lib/charts.js";
import { pct, money, tone, date } from "../lib/format.js";

const DEFAULT_COLUMNS = [
  { key: "d1", label: "1D", days: 1 },
  { key: "w1", label: "1W", days: 5 },
  { key: "m1", label: "1M", days: 21 },
  { key: "m3", label: "3M", days: 63 },
];

export default function table(opts, ctx) {
  const items = ctx.list(opts.list);
  const returns = opts.columns || DEFAULT_COLUMNS;
  const sparkDays = opts.sparkDays || 63;
  const hasAdded = items.some((t) => t.added);
  const hasNote = items.some((t) => t.note);
  let sort = { key: returns.find((c) => c.key === "m1")?.key || returns[0].key, dir: -1 };
  let tbl, empty;

  const cols = [
    { key: "sym", label: "Ticker", text: true },
    { key: "name", label: "Name", text: true, cls: "hide-sm" },
    { key: "price", label: "Price" },
    ...returns,
    ...(hasAdded ? [{ key: "since", label: "Since added" }] : []),
    { key: "spark", label: "Trend", cls: "hide-sm", nosort: true },
    ...(hasNote ? [{ key: "note", label: "Note", text: true, cls: "hide-sm note-col" }] : []),
    // Remove buttons, for hosted watchlist entries when signed in as an editor
    ...(["watchlist", "crypto"].includes(opts.list) && items.some((t) => ctx.canRemove?.(t.symbol)) ? [{ key: "remove", label: "", nosort: true, cls: "action" }] : []),
  ];

  return {
    mount(el) {
      const { tools } = cardHead(el, opts.title || "All tickers", opts.note || "Returns over trading days. Tap a column to sort, a row for details.");
      const edit = opts.editable && editLink(ctx);
      if (edit) tools.append(edit);
      empty = h("div", "card-empty");
      empty.append(h("p", null, "Nothing on this list yet."));
      if (edit) empty.append(editLink(ctx, "Add tickers on GitHub"));
      const wrap = h("div", "table-wrap");
      tbl = document.createElement("table");
      tbl.className = "linked";
      tbl.append(document.createElement("thead"), document.createElement("tbody"));
      tbl.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
      });
      wrap.append(tbl);
      el.append(empty, wrap);
    },
    render(el) {
      empty.hidden = items.length > 0;
      tbl.hidden = items.length === 0;
      if (!items.length) return;

      const tr = document.createElement("tr");
      for (const c of cols) {
        const th = h("th", c.cls);
        if (c.nosort) th.textContent = c.label;
        else {
          const b = h("button", null, c.label);
          b.addEventListener("click", () => {
            sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : c.text ? 1 : -1 };
            this.render(el);
          });
          th.append(b);
          if (sort.key === c.key) th.setAttribute("aria-sort", sort.dir > 0 ? "ascending" : "descending");
        }
        tr.append(th);
      }
      tbl.tHead.replaceChildren(tr);

      const rows = items.map((t) => {
        const r = { t, sym: t.symbol, name: t.name || "", price: ctx.lastClose(t.symbol), note: t.note || "" };
        for (const c of returns) r[c.key] = ctx.ret(t.symbol, c.days);
        if (hasAdded) r.since = t.added ? ctx.retSince(t.symbol, t.added) : null;
        return r;
      });
      rows.sort((a, b) => {
        const A = a[sort.key], B = b[sort.key];
        if (A == null || A === "") return 1; if (B == null || B === "") return -1;
        return (typeof A === "string" ? A.localeCompare(B) : A - B) * sort.dir;
      });

      tbl.tBodies[0].replaceChildren(...rows.map((r) => {
        const row = document.createElement("tr");
        row.dataset.sym = r.sym;
        const sym = h("td", "sym");
        const a = h("a", null, r.sym); a.href = ctx.href(r.sym);
        sym.append(a);
        if (r.sym === ctx.benchmark) sym.append(h("span", "group", "bench"));
        const eb = earningsBadge(ctx, r.sym); if (eb) sym.append(eb);
        row.append(sym, h("td", "name hide-sm", r.name));
        if (!ctx.has(r.sym)) {
          // on the list but not fetched yet
          const wait = h("td", "waiting", "Waiting for the next daily update");
          wait.colSpan = cols.length - 2 - (hasNote ? 1 : 0) - (cols.at(-1).key === "remove" ? 1 : 0);
          row.append(wait);
        } else {
          row.append(h("td", null, money(r.price)));
          for (const c of returns) row.append(h("td", tone(r[c.key]), pct(r[c.key])));
          if (hasAdded) {
            const td = h("td", tone(r.since), pct(r.since));
            if (r.t.added) td.title = `Since ${date(r.t.added, { month: "short", day: "numeric", year: "numeric" })}`;
            row.append(td);
          }
          const sp = h("td", "spark hide-sm");
          sparkline(sp, ctx.series(r.sym).slice(-sparkDays).map((p) => p.c));
          row.append(sp);
        }
        if (hasNote) row.append(h("td", "note-col hide-sm", r.note));
        if (cols.at(-1).key === "remove") {
          const td = h("td", "action");
          if (ctx.canRemove(r.sym)) {
            const b = h("button", "btn small ghost", "Remove");
            b.title = `Remove ${r.sym} from ${opts.list === "crypto" ? "Crypto" : "the watchlist"}`;
            b.addEventListener("click", async () => {
              if (!confirm(`Remove ${r.sym} from ${opts.list === "crypto" ? "Crypto" : "the watchlist"}?`)) return;
              b.disabled = true;
              try { await ctx.removeFromWatchlist(r.sym); }
              catch (e) { ctx.toast(e.message, true); b.disabled = false; }
            });
            td.append(b);
          }
          row.append(td);
        }
        return row;
      }));
    },
  };
}
