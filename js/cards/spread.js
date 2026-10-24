// Return of one ticker minus another over the selected period.
// Options: title, note, a, b (default: primary vs benchmark)
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";
import { pts, tone } from "../lib/format.js";

export default function spread(opts, ctx) {
  const a = opts.a || ctx.primary;
  const b = opts.b || ctx.benchmark;
  let big, chart;

  return {
    mount(el) {
      cardHead(el, opts.title || `${a} vs ${b}`, opts.note || `${a} return minus ${b} return, in percentage points.`);
      big = h("p", "big");
      chart = h("div", "chart small");
      el.append(big, chart);
    },
    render() {
      const s = ctx.spread(a, b);
      const v = s.at(-1)?.v;
      big.className = "big " + tone(v);
      big.replaceChildren(pts(v), h("small", null, ctx.range().word));
      lineChart(chart, s.length > 1 ? [{ label: "Spread", pts: s, color: v >= 0 ? "--up" : "--down", strong: true }] : [],
        { yFmt: (x) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}`, endLabels: false, area: true });
    },
  };
}
