// One ticker in detail: key figures and its price over the selected period.
// Options: symbol (default "$route", the ticker in the page address, e.g. #ticker/IWM)
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";
import { pct, pts, money, compact, tone, longDate } from "../lib/format.js";

export default function ticker(opts, ctx) {
  const sym = ctx.resolve(opts.symbol || "$route");
  const info = ctx.ticker(sym);
  let stats, chart, missing;

  return {
    mount(el) {
      ctx.setHeading?.(info ? `${sym} · ${info.name}` : sym || "Ticker");
      const { tools } = cardHead(el, "Price", info?.note || (info?.group ? `${info.group}` : null));
      const back = h("a", "tool-link", ctx.watchlist.some((w) => w.symbol === sym) ? "← Watchlist" : "← Overview");
      back.href = ctx.watchlist.some((w) => w.symbol === sym) ? "#watchlist" : "#overview";
      tools.append(back);
      missing = h("p", "card-empty");
      stats = h("div", "stats");
      chart = h("div", "chart");
      el.append(missing, stats, chart);
    },
    render() {
      const ok = sym && ctx.has(sym);
      missing.hidden = ok;
      stats.hidden = chart.hidden = !ok;
      if (!ok) {
        missing.textContent = !sym ? "No ticker chosen."
          : info ? `No prices for ${sym} yet. They arrive with the next daily update.`
          : `${sym} isn't in config.json. Add it to the watchlist to track it.`;
        return;
      }

      const win = ctx.window();
      const bars = ctx.bars(sym);
      const inWin = win.filter((d) => bars[d]);
      const last = bars[inWin.at(-1)];
      const highs = inWin.map((d) => bars[d].h), lows = inWin.map((d) => bars[d].l);
      const hi = Math.max(...highs), lo = Math.min(...lows);
      const avgVol = inWin.reduce((s, d) => s + bars[d].v, 0) / inWin.length;
      const period = ctx.rebased(sym).at(-1)?.v;
      const vsBench = sym !== ctx.benchmark ? ctx.spread(sym, ctx.benchmark).at(-1)?.v : null;
      const word = ctx.range().word;

      const items = [
        ["Last close", money(last.c), longDate(inWin.at(-1))],
        ["Day", pct(ctx.ret(sym, 1)), null, ctx.ret(sym, 1)],
        [`Change, ${word}`, pct(period), null, period],
        ...(vsBench != null ? [[`vs ${ctx.benchmark}`, pts(vsBench), word, vsBench]] : []),
        ["Period high", money(hi), `${pct(last.c / hi - 1)} from high`],
        ["Period low", money(lo), `${pct(last.c / lo - 1)} from low`],
        ["Avg. daily volume", compact(avgVol), word],
      ];
      if (info?.added) {
        const since = ctx.retSince(sym, info.added);
        items.push(["Since added", pct(since), longDate(info.added), since]);
      }

      stats.replaceChildren(...items.map(([label, value, sub, signed]) => {
        const s = h("div", "stat");
        s.append(h("div", "stat-label", label), h("div", "stat-value " + (signed != null ? tone(signed) : ""), value));
        if (sub) s.append(h("div", "stat-sub", sub));
        return s;
      }));

      lineChart(chart, [{
        label: sym,
        pts: inWin.map((d) => ({ d, v: bars[d].c })),
        color: (period ?? 0) >= 0 ? "--up" : "--down",
        strong: true,
      }], { yFmt: (v) => money(v), zero: null, endLabels: false, area: true });
    },
  };
}
