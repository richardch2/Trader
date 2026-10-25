// Russell 2000 breadth (data/breadth.json): how many stocks rose, the share above their
// 20- and 50-day averages over time, and new 20-day highs against lows.
// A rally that only a few big names carry shows up here as weak breadth.
// Options: title, note
import { cardHead, h } from "../core.js";
import { lineChart } from "../lib/charts.js";
import { longDate } from "../lib/format.js";

const share = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default function breadth(opts, ctx) {
  const data = ctx.data.breadth;
  let stats, chart, empty;

  return {
    mount(el) {
      cardHead(el, opts.title || "Market breadth", opts.note || "How many Russell 2000 stocks are taking part. Above 50% in uptrends is healthy; a falling line under a rising index is a warning.");
      empty = h("p", "card-empty", "Breadth arrives with the next data update.");
      stats = h("div", "stats");
      chart = h("div", "chart chart-short");
      el.append(empty, stats, chart);
    },
    render() {
      const days = data?.days || [];
      const t = days.at(-1);
      empty.hidden = !!t;
      stats.hidden = chart.hidden = !t;
      if (!t) return;
      const total = t.adv + t.dec;
      const items = [
        ["Rising", `${t.adv.toLocaleString()} of ${total.toLocaleString()}`, `${share(t.adv / total)} · ${longDate(t.d)}`, t.adv - t.dec],
        ["Above 20-day avg", share(t.above20), trend(days, "above20"), t.above20 == null ? null : t.above20 - 0.5],
        ["Above 50-day avg", share(t.above50), trend(days, "above50"), t.above50 == null ? null : t.above50 - 0.5],
        ["New 20-day highs / lows", t.highs == null ? "—" : `${t.highs} / ${t.lows}`, null, t.highs == null ? null : t.highs - t.lows],
      ];
      stats.replaceChildren(...items.map(([label, value, sub, signed]) => {
        const s = h("div", "stat");
        s.append(h("div", "stat-label", label), h("div", "stat-value " + (signed == null ? "" : signed > 0 ? "pos" : signed < 0 ? "neg" : ""), value));
        if (sub) s.append(h("div", "stat-sub", sub));
        return s;
      }));
      const line = (key, label, color, strong) => ({
        label, color, strong, pts: days.filter((d) => d[key] != null).map((d) => ({ d: d.d, v: d[key] })),
      });
      lineChart(chart, [line("above50", "50-day", "--s2", false), line("above20", "20-day", "--s1", true)].filter((l) => l.pts.length > 1),
        { yFmt: (v) => `${Math.round(v * 100)}%`, zero: 0.5 });
    },
  };
}

/** "+6 pts this week" from the share 5 days ago. */
function trend(days, key) {
  const now = days.at(-1)?.[key], then = days.at(-6)?.[key];
  if (now == null || then == null) return null;
  const d = Math.round((now - then) * 100);
  return `${d > 0 ? "+" : ""}${d} pts this week`;
}
