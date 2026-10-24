// Sortable table of every ticker.
// Options: title, note, columns (return periods in trading days), sparkDays
import { cardHead, h } from "../core.js";
import { sparkline } from "../lib/charts.js";
import { pct, money, tone } from "../lib/format.js";

const DEFAULT_COLUMNS = [
  { key: "d1", label: "1D", days: 1 },
  { key: "w1", label: "1W", days: 5 },
  { key: "m1", label: "1M", days: 21 },
  { key: "m3", label: "3M", days: 63 },
];

export default function table(opts, ctx) {
  const returns = opts.columns || DEFAULT_COLUMNS;
  const sparkDays = opts.sparkDays || 63;
  let sort = { key: returns.find((c) => c.key === "m1")?.key || returns[0].key, dir: -1 };
  let tbl;

  const cols = [
    { key: "sym", label: "Ticker", text: true },
    { key: "name", label: "Name", text: true, cls: "hide-sm" },
    { key: "price", label: "Price" },
    ...returns,
    { key: "spark", label: "Trend", cls: "hide-sm", nosort: true },
  ];

  return {
    mount(el) {
      cardHead(el, opts.title || "All tickers", opts.note || "Returns over trading days. Tap a column to sort.");
      const wrap = h("div", "table-wrap");
      tbl = document.createElement("table");
      tbl.append(document.createElement("thead"), document.createElement("tbody"));
      wrap.append(tbl);
      el.append(wrap);
    },
    render(el) {
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

      const rows = ctx.tickers.map((t) => {
        const r = { t, sym: t.symbol, name: t.name, price: ctx.lastClose(t.symbol) };
        for (const c of returns) r[c.key] = ctx.ret(t.symbol, c.days);
        return r;
      });
      rows.sort((a, b) => {
        const A = a[sort.key], B = b[sort.key];
        if (A == null) return 1; if (B == null) return -1;
        return (typeof A === "string" ? A.localeCompare(B) : A - B) * sort.dir;
      });

      tbl.tBodies[0].replaceChildren(...rows.map((r) => {
        const row = document.createElement("tr");
        const sym = h("td", "sym", r.sym);
        if (r.sym === ctx.benchmark) sym.append(h("span", "group", "bench"));
        row.append(sym, h("td", "name hide-sm", r.name), h("td", null, money(r.price)));
        for (const c of returns) row.append(h("td", tone(r[c.key]), pct(r[c.key])));
        const sp = h("td", "spark hide-sm");
        sparkline(sp, ctx.series(r.sym).slice(-sparkDays).map((p) => p.c));
        row.append(sp);
        return row;
      }));
    },
  };
}
