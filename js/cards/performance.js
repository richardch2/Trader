// Line chart of each ticker's change over the selected period, with a toggleable legend.
// Options: title, note,
//   list      – "tickers" (default) or "watchlist": chart every ticker in that list
//   symbols   – explicit symbols instead of a list; may use "$route", "$primary", "$benchmark"
//   highlight – symbols drawn bold (default: primary and benchmark); others are muted
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";

export default function performance(opts, ctx) {
  const symbols = [...new Set(
    (opts.symbols ? opts.symbols.map(ctx.resolve) : ctx.list(opts.list).map((t) => t.symbol)).filter(Boolean)
  )];
  // an explicit symbol list gets its own colors, so mixed lists never share one
  const PALETTE = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];
  let n = 0;
  const own = opts.symbols ? Object.fromEntries(symbols.map((s) => [s, s === ctx.benchmark ? "--bench" : PALETTE[n++ % PALETTE.length]])) : null;
  const color = (s) => own?.[s] || ctx.color(s);
  const highlight = new Set((opts.highlight || ["$primary", "$benchmark"]).map(ctx.resolve));
  const hidden = new Set();
  let chart, empty;

  const defaultNote = symbols.includes(ctx.benchmark)
    ? `Change since the start of the period. ${ctx.benchmark} dashed for comparison; tap a ticker to hide it.`
    : "Change since the start of the period. Tap a ticker to hide it.";

  return {
    mount(el) {
      cardHead(el, opts.title || "Performance", opts.note || defaultNote);
      chart = h("div", "chart");
      empty = h("p", "card-empty", "No price history yet for these tickers. It arrives with the next daily update.");
      const legend = h("div", "legend");
      for (const sym of symbols.filter(ctx.has)) {
        const b = h("button");
        b.setAttribute("aria-pressed", "true");
        b.title = ctx.ticker(sym)?.name || sym;
        const sw = h("span", "swatch" + (sym === ctx.benchmark ? " dash" : ""));
        sw.style.background = `var(${color(sym)})`;
        b.append(sw, sym);
        b.addEventListener("click", () => {
          hidden.has(sym) ? hidden.delete(sym) : hidden.add(sym);
          b.setAttribute("aria-pressed", String(!hidden.has(sym)));
          this.render(el);
        });
        legend.append(b);
      }
      el.append(chart, empty, legend);
    },
    render() {
      const anyData = symbols.some(ctx.has);
      chart.hidden = !anyData;
      empty.hidden = anyData;
      const lines = symbols
        .filter((s) => !hidden.has(s))
        .map((s) => ({
          label: s,
          pts: ctx.rebased(s),
          color: color(s),
          dashed: s === ctx.benchmark,
          strong: highlight.size === 0 || highlight.has(s),
          muted: highlight.size > 0 && !highlight.has(s),
        }))
        .filter((l) => l.pts.length > 1)
        .sort((a, b) => Number(a.strong) - Number(b.strong)); // bold lines on top
      lineChart(chart, lines);
    },
  };
}
