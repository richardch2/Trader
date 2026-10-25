// Russell 2000 sector map (data/breadth.json): each sector's median return over a day,
// a week or a month, shaded by size, with the share of its stocks rising today.
// Tap a sector for its biggest movers today.
// Options: title, note
import { cardHead, h } from "../core.js";
import { pct } from "../lib/format.js";

const PERIODS = [["d1", "1D", "today"], ["w1", "1W", "this week"], ["m1", "1M", "this month"]];

export default function sectors(opts, ctx) {
  const list = ctx.data.breadth?.sectors || [];
  let key = "d1", open = null, buttons, grid, detail;

  function drawDetail() {
    detail.replaceChildren();
    const s = list.find((x) => x.name === open);
    if (!s) { detail.hidden = true; return; }
    detail.hidden = false;
    detail.append(h("h3", null, `${s.name} · biggest moves today`));
    const cols = h("div", "movers");
    for (const [label, rows] of [["Up", s.up], ["Down", s.down]]) {
      const col = h("div", "movers-col");
      col.append(h("h3", null, label));
      if (!rows.length) col.append(h("p", "muted", "None"));
      for (const r of rows) {
        const a = h("a", "mover");
        a.href = ctx.href(r.symbol);
        const name = ctx.data.smallcaps?.members?.[r.symbol]?.[0] || "";
        a.append(h("span", "sym", r.symbol), h("span", "muted mover-name", name), h("span", r.change > 0 ? "pos" : "neg", pct(r.change)));
        col.append(a);
      }
      cols.append(col);
    }
    detail.append(cols);
  }

  return {
    mount(el) {
      const { tools } = cardHead(el, opts.title || "Sectors", opts.note || "Median return of each Russell 2000 sector. Tap one for its biggest movers.");
      buttons = h("div", "ranges seg");
      buttons.setAttribute("role", "group");
      buttons.setAttribute("aria-label", "Sector period");
      for (const [k, label] of PERIODS) {
        const b = h("button", null, label);
        b.dataset.key = k;
        b.addEventListener("click", () => { key = k; this.render(); });
        buttons.append(b);
      }
      tools.append(buttons);
      grid = h("div", "sector-grid");
      detail = h("div", "sector-detail");
      detail.hidden = true;
      el.append(grid, detail);
    },
    render() {
      buttons.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
      grid.replaceChildren();
      if (!list.length) { grid.append(h("p", "card-empty", "Sectors arrive with the next data update.")); return; }
      const word = PERIODS.find((p) => p[0] === key)[2];
      const scale = Math.max(0.005, ...list.map((s) => Math.abs(s[key] ?? 0)));
      for (const s of [...list].sort((a, b) => (b[key] ?? -9) - (a[key] ?? -9))) {
        const v = s[key];
        const b = h("button", "sector-tile");
        // shade by size: the biggest move this period gets the strongest tint
        const strength = v == null ? 0 : Math.round(8 + (Math.abs(v) / scale) * 32);
        b.style.background = v == null ? "" : `color-mix(in srgb, var(${v >= 0 ? "--up" : "--down"}) ${strength}%, var(--panel))`;
        b.setAttribute("aria-pressed", String(open === s.name));
        b.setAttribute("aria-label", `${s.name}: ${pct(v)} ${word}`);
        b.append(h("span", "sector-name", s.name), h("span", "sector-ret", pct(v)),
          h("span", "sector-sub", key === "d1" && s.advShare != null ? `${Math.round(s.advShare * 100)}% rising · ${s.n}` : `${s.n} stocks`));
        b.addEventListener("click", () => { open = open === s.name ? null : s.name; this.render(); });
        grid.append(b);
      }
      drawDetail();
    },
  };
}
