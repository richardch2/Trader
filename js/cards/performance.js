// Main chart: every ticker's change over the selected period, with a toggleable legend.
// Options: title, note, symbols (default: all tickers), highlight (default: [primary, benchmark])
import { cardHead, h } from "../core.js";
import { lineChart, css } from "../lib/charts.js";

export default function performance(opts, ctx) {
  const symbols = opts.symbols || ctx.tickers.map((t) => t.symbol);
  const highlight = new Set(opts.highlight || [ctx.primary, ctx.benchmark]);
  const hidden = new Set();
  let chart;

  return {
    mount(el) {
      cardHead(el, opts.title || "Performance",
        opts.note || `Change since the start of the period. ${ctx.benchmark} dashed for comparison; tap a ticker to hide it.`);
      chart = h("div", "chart");
      const legend = h("div", "legend");
      for (const sym of symbols) {
        const b = h("button");
        b.setAttribute("aria-pressed", "true");
        b.title = ctx.ticker(sym)?.name || sym;
        const sw = h("span", "swatch" + (sym === ctx.benchmark ? " dash" : ""));
        sw.style.background = `var(${ctx.color(sym)})`;
        b.append(sw, sym);
        b.addEventListener("click", () => {
          hidden.has(sym) ? hidden.delete(sym) : hidden.add(sym);
          b.setAttribute("aria-pressed", String(!hidden.has(sym)));
          this.render(el);
        });
        legend.append(b);
      }
      el.append(chart, legend);
    },
    render() {
      const lines = symbols
        .filter((s) => !hidden.has(s))
        .map((s) => ({
          label: s,
          pts: ctx.rebased(s),
          color: ctx.color(s),
          dashed: s === ctx.benchmark,
          strong: highlight.has(s),
          muted: !highlight.has(s),
        }))
        .filter((l) => l.pts.length > 1)
        .sort((a, b) => Number(a.strong) - Number(b.strong)); // highlighted lines on top
      lineChart(chart, lines);
    },
  };
}
