// Moving averages, RSI and MACD for one ticker: price with its 20- and 50-day averages
// over the selected period, plus the day's signals from data/picks.json.
// Options: symbol (default "$route"), title, note
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";
import { pct, money, tone } from "../lib/format.js";
import { signalsCell } from "./picks.js";

/** Simple moving average of [{d, c}], as [{d, v}] from the n-th point on. */
function sma(series, n) {
  const out = [];
  let total = 0;
  series.forEach((p, i) => {
    total += p.c;
    if (i >= n) total -= series[i - n].c;
    if (i >= n - 1) out.push({ d: p.d, v: total / n });
  });
  return out;
}

export default function technicals(opts, ctx) {
  const sym = ctx.resolve(opts.symbol || "$route");
  const p = ctx.data.picks;
  const row = p?.watchlist?.[sym] || p?.picks?.find((r) => r.symbol === sym) || p?.cautions?.find((r) => r.symbol === sym);
  let stats, chart, signals, missing;

  return {
    mount(el) {
      cardHead(el, opts.title || "Technicals", opts.note || "Price against its 20- and 50-day moving averages. Signals, not advice.");
      missing = h("p", "card-empty");
      stats = h("div", "stats");
      signals = h("div");
      chart = h("div", "chart");
      el.append(missing, stats, signals, chart);
    },
    render() {
      const series = sym ? ctx.series(sym) : [];
      const hasChart = series.length >= 21;
      missing.hidden = hasChart || !!row;
      chart.hidden = !hasChart;
      stats.hidden = !row;
      signals.replaceChildren();
      missing.textContent = `Moving averages appear once ${sym || "this ticker"} has 21 days of prices.`;

      if (row) {
        const { ind } = row;
        const vs = (ma) => (ma ? row.price / ma - 1 : null);
        const items = [
          ["Signal score", `${row.score > 0 ? "+" : ""}${row.score}`, row.score >= 3 ? "Bullish" : row.score <= -3 ? "Bearish" : "Mixed", row.score],
          ["vs 20-day avg", pct(vs(ind.sma20)), money(ind.sma20), vs(ind.sma20)],
          ["vs 50-day avg", pct(vs(ind.sma50)), ind.sma50 ? money(ind.sma50) : "needs 50 days", vs(ind.sma50)],
          ...(ind.sma200 ? [["vs 200-day avg", pct(vs(ind.sma200)), money(ind.sma200), vs(ind.sma200)]] : []),
          ["RSI (14)", ind.rsi?.toFixed(0) ?? "—", ind.rsi > 70 ? "Overbought" : ind.rsi < 30 ? "Oversold" : "Neutral"],
          ["MACD", ind.macd?.toFixed(2) ?? "—", ind.macdSignal != null ? `${ind.macd >= ind.macdSignal ? "above" : "below"} signal ${ind.macdSignal.toFixed(2)}` : null,
            ind.macdSignal != null ? ind.macd - ind.macdSignal : null],
          ["20-day change", pct(ind.mom20), null, ind.mom20],
        ];
        stats.replaceChildren(...items.map(([label, value, sub, signed]) => {
          const s = h("div", "stat");
          s.append(h("div", "stat-label", label), h("div", "stat-value " + (signed != null ? tone(signed) : ""), value));
          if (sub) s.append(h("div", "stat-sub", sub));
          return s;
        }));
        signals.append(signalsCell(row.signals, "div"));
      }

      if (hasChart) {
        const win = new Set(ctx.window());
        const inWin = (pts) => pts.filter((q) => win.has(q.d));
        const lines = [
          { label: sym, pts: inWin(series.map((q) => ({ d: q.d, v: q.c }))), color: "--bench", strong: true },
          { label: "20-day", pts: inWin(sma(series, 20)), color: "--s1" },
          { label: "50-day", pts: inWin(sma(series, 50)), color: "--s2" },
        ].filter((l) => l.pts.length > 1);
        lineChart(chart, lines, { yFmt: (v) => money(v), zero: null });
      }
    },
  };
}
