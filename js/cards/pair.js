// Two tickers head to head, with the leader called out.
// Options: title, note, series: [{symbol, label}, {symbol, label}]
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";

export default function pair(opts, ctx) {
  const series = opts.series;
  if (!series || series.length !== 2) throw new Error('needs "series" with exactly two {symbol, label} entries');
  const colors = ["--s3", "--s4"];
  let big, chart;

  return {
    mount(el) {
      cardHead(el, opts.title || series.map((s) => s.label).join(" vs "), opts.note);
      big = h("p", "big", "—");
      chart = h("div", "chart small");
      el.append(big, chart);
    },
    render() {
      const lines = series
        .filter((s) => ctx.has(s.symbol))
        .map((s, i) => ({ label: s.label || s.symbol, pts: ctx.rebased(s.symbol), color: colors[i], strong: true }))
        .filter((l) => l.pts.length > 1);
      if (lines.length === 2) {
        const gap = lines[0].pts.at(-1).v - lines[1].pts.at(-1).v;
        big.textContent = `${(gap >= 0 ? lines[0] : lines[1]).label} by ${Math.abs(gap * 100).toFixed(1)} pts`;
      } else big.textContent = "—";
      lineChart(chart, lines);
    },
  };
}
