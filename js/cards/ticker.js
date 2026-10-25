// One ticker in detail: key figures and its price over the selected period.
// Options: symbol (default "$route", the ticker in the page address, e.g. #ticker/IWM)
import { cardHead, h, isCrypto } from "../core.js";
import { lineChart } from "../lib/charts.js";
import { pct, pts, money, compact, tone, longDate, date } from "../lib/format.js";

export default function ticker(opts, ctx) {
  const sym = ctx.resolve(opts.symbol || "$route");
  const coin = isCrypto(sym);
  const where = coin ? "Crypto" : "the watchlist";
  /** Add / Remove button for the hosted watchlist (nothing when signed out or no database). */
  function watchButton() {
    const wrap = h("span", "watch-btn");
    if (!ctx.db?.canEdit || !sym) return wrap;
    if (ctx.onWatchlist(sym)) {
      if (!ctx.canRemove(sym)) { wrap.append(h("span", "watching", "✓ Watching")); return wrap; }
      const b = h("button", "btn small ghost", "✓ Watching · Remove");
      b.addEventListener("click", async () => {
        if (!confirm(`Remove ${sym} from ${where}?`)) return;
        b.disabled = true;
        try { await ctx.removeFromWatchlist(sym); } catch (e) { ctx.toast(e.message, true); b.disabled = false; }
      });
      wrap.append(b);
    } else {
      const b = h("button", "btn small", coin ? "+ Add to Crypto" : "+ Add to watchlist");
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await ctx.addToWatchlist({ symbol: sym, name: info?.name || null, source: "manual" }); }
        catch (e) { ctx.toast(e.message, true); b.disabled = false; }
      });
      wrap.append(b);
    }
    return wrap;
  }

  const member = ctx.data.smallcaps?.members?.[sym];   // [name, sector] if in the Russell 2000
  const info = ctx.ticker(sym) || (member ? { symbol: sym, name: member[0], group: `Russell 2000 · ${member[1]}` } : null);
  let stats, chart, missing;

  return {
    mount(el) {
      ctx.setHeading?.(info ? `${sym} · ${info.name}` : sym || "Ticker");
      const { tools } = cardHead(el, "Price", info?.note || (info?.group ? `${info.group}` : null));
      const listed = ctx.onWatchlist?.(sym) || ctx.watchlist.some((w) => w.symbol === sym);
      const back = h("a", "tool-link", coin ? "← Crypto" : listed || member ? "← Watchlist" : "← Overview");
      back.href = coin ? "#crypto" : listed || member ? "#watchlist" : "#overview";
      tools.append(watchButton(), back);
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
        const g = ctx.data.smallcaps?.gainers?.find((x) => x.symbol === sym);
        const last = ctx.data.smallcaps?.prices?.[sym];
        const listed = ctx.onWatchlist?.(sym);
        missing.textContent = !sym ? "No ticker chosen."
          : g ? `Closed at ${money(g.price)} on ${date(ctx.data.smallcaps.asOf)}, ${pct(g.change)} on the day. ${listed ? "Price history arrives with the next daily update." : "Add it to the watchlist to track its price history."}`
          : last ? `Last close ${money(last)} (${date(ctx.data.smallcaps.asOf)}). ${listed ? "Price history arrives with the next daily update." : "Add it to the watchlist to track its price history."}`
          : info ? `No prices for ${sym} yet. They arrive with the next daily update.`
          : `${sym} isn't tracked yet. Add it to ${where} to follow it.`;
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
        [coin ? "Daily close (UTC)" : "Last close", money(last.c), longDate(inWin.at(-1))],
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
