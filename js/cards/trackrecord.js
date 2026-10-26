// How the daily ideas did afterwards (picks.json "track", kept by scripts/fetchers/track.py):
// average return 5 and 20 trading days later, how often they went the expected way, and
// how they did against the Russell 2000 (IWM) over the same days, plus recent results.
// Options: title, note, lists (default ["picks", "cautions"])
import { cardHead, h } from "../core.js";
import { pct, money, tone, date } from "../lib/format.js";

const LABELS = { picks: "Picks", cautions: "Weakening", picksLow: "$1–$5 picks", cautionsLow: "$1–$5 weakening" };
const share = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const pts = (x) => (x == null ? "—" : Math.abs(x) < 0.0005 ? "0.0 pts" : `${x > 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`);

export default function trackrecord(opts, ctx) {
  const lists = opts.lists || ["picks", "cautions"];
  let statsBox, tableBox, noteEl;

  function tile(name, k, s) {
    const down = name.startsWith("cautions");
    const el = h("div", "stat");
    el.append(h("div", "stat-label", `${LABELS[name]} · ${k} days later`));
    if (!s?.n) {
      el.append(h("div", "stat-value muted", "—"), h("div", "stat-sub", "No results yet"));
      return el;
    }
    // for cautions, falling is the call coming true, so it reads as good
    el.append(h("div", "stat-value " + tone(down ? -s.avg : s.avg), pct(s.avg)));
    const sub = h("div", "stat-sub");
    sub.append(`${share(s.hit)} ${down ? "fell" : "rose"} · ${pts(s.excess)} vs index`);
    sub.title = `${s.n.toLocaleString()} ideas (${s.live.toLocaleString()} live). ${share(s.beat)} did better than the index${down ? " the expected way (fell more or rose less)" : ""}.`;
    el.append(sub, h("div", "stat-sub", `${s.n.toLocaleString()} ideas${s.live < s.n ? `, ${s.live} live` : ""}`));
    return el;
  }

  return {
    mount(el) {
      const head = cardHead(el, opts.title || "Track record", " ");
      noteEl = head.note;
      statsBox = h("div", "stats");
      tableBox = h("div", "table-wrap");
      el.append(statsBox, tableBox);
    },
    render() {
      const t = ctx.data.picks?.track;
      if (!t) {
        noteEl.textContent = "The track record starts with the next daily update.";
        statsBox.replaceChildren();
        tableBox.replaceChildren();
        return;
      }
      const since = t.since ? date(t.since, { month: "short", day: "numeric", year: "numeric" }) : null;
      noteEl.textContent = opts.note || (
        "Each idea's return from its close on the day it was listed, next to the Russell 2000 (IWM) over the same days. "
        + (t.backtestFrom
          ? `Results before ${since} come from a back-test (the same rules re-run on past prices from ${date(t.backtestFrom, { month: "short", year: "numeric" })}), so treat them as a rough guide. `
          : "")
        + "Past results don't promise future ones.");

      statsBox.replaceChildren(...lists.flatMap((name) => {
        const l = t.lists?.[name];
        return [tile(name, 5, l?.k5), tile(name, 20, l?.k20)];
      }));

      const recent = lists.flatMap((name) => (t.lists?.[name]?.recent || []).map((e) => ({ ...e, list: name })))
        .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)).slice(0, 15);
      tableBox.replaceChildren();
      if (!recent.length) return;
      const table = document.createElement("table");
      table.className = "linked";
      const head = document.createElement("tr");
      for (const [label, cls] of [["Listed", "left"], ["Ticker"], ["List", "left hide-sm"], ["Price"], ["5 days"], ["Index", "hide-sm"], ["20 days"]]) {
        head.append(h("th", cls, label));
      }
      table.createTHead().append(head);
      const body = table.createTBody();
      for (const e of recent) {
        const tr = document.createElement("tr");
        tr.dataset.sym = e.s;
        const sym = h("td", "sym");
        const a = h("a", null, e.s); a.href = ctx.href(e.s);
        sym.append(a);
        const when = h("td", "left muted", date(e.d, { month: "short", day: "numeric" }));
        if (e.bt) when.title = "Back-tested";
        tr.append(when, sym, h("td", "left muted hide-sm", LABELS[e.list] + (e.bt ? " (back-test)" : "")), h("td", null, money(e.p)),
          h("td", tone(e.r5), pct(e.r5)), h("td", "hide-sm muted", pct(e.b5)), h("td", tone(e.r20), e.r20 == null ? "pending" : pct(e.r20)));
        body.append(tr);
      }
      table.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a")) location.hash = ctx.href(row.dataset.sym);
      });
      tableBox.append(h("h3", "subhead", "Recent results"), table);
    },
  };
}
