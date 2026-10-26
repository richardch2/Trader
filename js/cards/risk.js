// Dilution and squeeze risk for the stock on the ticker page (data/risk.json, from
// scripts/fetchers/risk.py): float, shares outstanding and how much it grew in a year,
// short interest and any recent split, with the flags that matter most up top.
// Options: title, note
import { cardHead, h, isCrypto } from "../core.js";
import { pct, date } from "../lib/format.js";

const shares = (n) => (n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(1)}M`);

export default function risk(opts, ctx) {
  let box, noteEl, el;
  return {
    mount(e) {
      el = e;
      const head = cardHead(el, opts.title || "Dilution and short interest", " ");
      noteEl = head.note;
      box = h("div");
      el.append(box);
    },
    render() {
      const sym = ctx.route?.arg;
      const index = (ctx.config.tickers || []).some((t) => t.symbol === sym);
      el.hidden = !sym || isCrypto(sym) || index || sym.startsWith("^");
      if (el.hidden) return;
      const r = ctx.data.risk?.stocks?.[sym];
      box.replaceChildren();
      if (!r) {
        noteEl.textContent = "Float, short interest and share sales.";
        box.append(h("p", "card-empty", ctx.data.risk
          ? `${sym} isn't checked yet. Stocks on the Top 10, picks and watchlist are checked with each daily update.`
          : "Risk checks start with the next daily update."));
        return;
      }
      noteEl.textContent = opts.note || `From Yahoo Finance, checked ${date(r.checked)}. Share sales dilute existing holders; heavy short interest on a small float can drive sharp swings either way.`;
      if (r.flags?.length) {
        const flags = h("div", "signals");
        for (const f of r.flags) flags.append(h("span", `signal ${f.tone}`, f.text));
        box.append(flags);
      } else {
        box.append(h("p", "muted", "No dilution, reverse split or heavy short interest found."));
      }
      const facts = h("div", "risk-facts");
      const fact = (label, value, sub) => {
        const s = h("div", "stat");
        s.append(h("div", "stat-label", label), h("div", "stat-value", value));
        if (sub) s.append(h("div", "stat-sub", sub));
        facts.append(s);
      };
      fact("Float", shares(r.float), r.float && r.sharesOut ? `${Math.round((r.float / r.sharesOut) * 100)}% of shares` : null);
      fact("Shares outstanding", shares(r.sharesOut), r.sharesChange != null ? `${pct(r.sharesChange)} in a year` : null);
      fact("Short interest", r.shortPct == null ? "—" : pct(r.shortPct, false),
        [r.shortRatio ? `${r.shortRatio.toFixed(1)} days to cover` : null, r.shortDate ? `as of ${date(r.shortDate)}` : null].filter(Boolean).join(" · ") || "of the float");
      if (r.split) {
        const n = r.split.ratio < 1 ? `1-for-${Math.round(1 / r.split.ratio)} reverse` : `${r.split.ratio}-for-1`;
        fact("Last split", n, date(r.split.date, { month: "short", day: "numeric", year: "numeric" }));
      }
      box.append(facts);
    },
  };
}
