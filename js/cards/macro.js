// Macro backdrop: the 10-year Treasury yield, VIX and the dollar index (config.macro).
// Small caps borrow more and sell more at home, so falling yields, a calm VIX and a
// softer dollar tend to help them. Changes are coloured by that: green = a tailwind.
// Options: title, note, days (trend line length, default 63)
import { cardHead, h } from "../core.js";
import { sparkline } from "../lib/charts.js";
import { money, pct } from "../lib/format.js";

/** How each kind of number reads: a yield moves in percentage points, the others in %. */
const KINDS = {
  yield: { value: (v) => `${v.toFixed(2)}%`, change: (a, b) => a - b, fmt: (d) => { const bp = Math.round(d * 100); return `${bp > 0 ? "+" : ""}${bp} bp`; } },
  level: { value: (v) => money(v), change: (a, b) => a / b - 1, fmt: (d) => pct(d) },
};

export default function macro(opts, ctx) {
  const items = ctx.list("macro");
  const days = opts.days || 63;
  let grid;

  return {
    mount(el) {
      cardHead(el, opts.title || "Macro backdrop", opts.note || "Green means a tailwind for small caps: falling yields, a calmer VIX, a softer dollar.");
      grid = h("div", "macro-grid");
      el.append(grid);
    },
    render() {
      grid.replaceChildren();
      const shown = items.filter((m) => ctx.has(m.symbol));
      if (!shown.length) { grid.append(h("p", "card-empty", "Arrives with the next daily update.")); return; }
      for (const m of shown) {
        const kind = KINDS[m.kind] || KINDS.level;
        const s = ctx.series(m.symbol);
        const last = s.at(-1).c;
        const at = (n) => (s.length > n ? s.at(-1 - n).c : null);
        const d1 = at(1) != null ? kind.change(last, at(1)) : null;
        const m1 = at(21) != null ? kind.change(last, at(21)) : null;
        // rising yields, VIX or dollar = a headwind, so a rise shows red
        const cls = (d) => (d == null || d === 0 ? "" : d < 0 ? "pos" : "neg");

        const a = h("a", "macro-tile");
        a.href = ctx.href(m.symbol);
        a.append(h("div", "stat-label", m.name), h("div", "stat-value", kind.value(last)));
        const sub = h("div", "macro-changes");
        sub.append(h("span", cls(d1), d1 == null ? "—" : kind.fmt(d1)), h("span", "muted", " day · "),
          h("span", cls(m1), m1 == null ? "—" : kind.fmt(m1)), h("span", "muted", " month"));
        const sp = h("div", "macro-spark");
        sparkline(sp, s.slice(-days).map((p) => p.c), 120, 28, true);
        a.append(sub, sp);
        if (m.hint) a.append(h("div", "stat-sub macro-hint", m.hint));
        grid.append(a);
      }
    },
  };
}
