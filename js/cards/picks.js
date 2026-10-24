// Daily ideas from moving averages, MACD and RSI (data/picks.json): each stock with its
// score, the signals behind it, and a button to add it to the hosted watchlist.
// Options: title, note, list ("picks" default, "cautions", "watchlist" or "tickers"), count,
// notify (default true on the picks list: the "Notify me" control for new picks)
import { cardHead, h, addCell, signInButton } from "../core.js";
import { pct, money, tone, date } from "../lib/format.js";
import { pushState, enablePush, disablePush } from "../lib/push.js";

const TITLES = {
  picks: "Today's picks",
  cautions: "Weakening",
  watchlist: "Watchlist signals",
  tickers: "Index signals",
};
const NOTES = {
  picks: "Russell 2000 stocks ($5 and up) with the strongest buy signals: moving-average and MACD crossovers, RSI rebounds, strength against the index.",
  cautions: "Russell 2000 stocks with the strongest sell signals.",
  watchlist: "Moving averages, MACD and RSI for each stock you watch.",
  tickers: "Moving averages, MACD and RSI for each index ETF.",
};
const MIN_DAYS = 21;

export default function picks(opts, ctx) {
  const data = ctx.data.picks;
  const which = opts.list || "picks";
  const count = opts.count || (which === "cautions" ? 5 : 10);
  let body, noteEl;

  function rows() {
    if (which === "picks" || which === "cautions") return (data?.[which] || []).slice(0, count);
    const sigs = data?.watchlist || {};
    return ctx.list(which)
      .map((t) => sigs[t.symbol] ? { ...sigs[t.symbol], name: sigs[t.symbol].name || t.name } : { symbol: t.symbol, name: t.name, waiting: true })
      .sort((a, b) => (b.score ?? -99) - (a.score ?? -99));
  }

  return {
    mount(el) {
      const head = cardHead(el, opts.title || TITLES[which] || TITLES.picks, " ");
      noteEl = head.note;
      if (which === "picks" && opts.notify !== false) notifyControl(head.tools);
      body = h("div", "table-wrap");
      el.append(body);
    },
    render() {
      const list = rows();
      const when = data?.asOf ? ` As of ${date(data.asOf, { weekday: "short", month: "short", day: "numeric" })}.` : "";
      noteEl.textContent = opts.note || `${NOTES[which] || ""}${when}`;
      body.replaceChildren();
      if (!list.length) {
        body.append(h("p", "card-empty", emptyText()));
        return;
      }

      const scan = which === "picks" || which === "cautions";
      const showAction = ctx.db.enabled && which !== "tickers";
      const table = document.createElement("table");
      table.className = "linked picks";
      const head = document.createElement("tr");
      for (const [label, cls] of [["#", "rank"], ["Ticker"], ["Name", "left hide-md"], ["Price"], ["RSI", "hide-sm"],
        ["vs 50-day", "hide-sm"], ["Score"], ["Signals", "left signals-col"], ...(showAction ? [["", "action"]] : [])]) {
        head.append(h("th", cls, label));
      }
      table.createTHead().append(head);
      const tbody = table.createTBody();
      list.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.dataset.sym = r.symbol;
        const sym = h("td", "sym");
        const a = h("a", null, r.symbol); a.href = ctx.href(r.symbol);
        sym.append(a);
        tr.append(h("td", "rank muted", String(i + 1)), sym, h("td", "name left hide-md", r.name || ""));
        if (r.waiting) {
          const td = h("td", "waiting", `Signals start once there are ${MIN_DAYS} days of prices.`);
          td.colSpan = 5;
          tr.append(td);
        } else {
          const vs50 = r.ind.sma50 ? r.price / r.ind.sma50 - 1 : null;
          tr.append(h("td", null, money(r.price)), h("td", "hide-sm " + rsiTone(r.ind.rsi), r.ind.rsi?.toFixed(0) ?? "—"),
            h("td", "hide-sm " + tone(vs50), pct(vs50)), scoreCell(r.score), signalsCell(r.signals));
        }
        if (showAction) tr.append(addCell(ctx, r, scan ? "picks" : "manual"));
        tbody.append(tr);
      });
      table.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
      });
      body.append(table);
    },
  };

  /** "Notify me" for new picks, or what's needed first (sign in, install the app). */
  async function notifyControl(box) {
    const busy = (b, text) => { b.disabled = true; b.textContent = text; };
    const draw = async () => {
      const state = await pushState(ctx.db).catch(() => "unavailable");
      box.replaceChildren();
      if (state === "off") {
        const b = h("button", "btn small", "🔔 Notify me");
        b.title = "Get a notification when there are new picks";
        b.addEventListener("click", async () => {
          busy(b, "Turning on…");
          try { await enablePush(ctx.db); ctx.toast("Notifications on. You'll hear when there are new picks."); }
          catch (e) { ctx.toast(e.message, true); }
          draw();
        });
        box.append(b);
      } else if (state === "on") {
        const test = h("button", "link-btn", "Send test");
        test.addEventListener("click", async () => {
          busy(test, "Sending…");
          try {
            const r = await ctx.db.testPush();
            ctx.toast(r.sent ? "Test sent. It should arrive in a few seconds." : "Couldn't reach this device. Turn notifications off and on again.", !r.sent);
          } catch (e) { ctx.toast(e.message, true); }
          test.disabled = false; test.textContent = "Send test";
        });
        const off = h("button", "link-btn", "Turn off");
        off.addEventListener("click", async () => {
          busy(off, "Turning off…");
          try { await disablePush(ctx.db); ctx.toast("Notifications off on this device."); }
          catch (e) { ctx.toast(e.message, true); }
          draw();
        });
        box.append(h("span", "watching", "🔔 Notifications on"), test, off);
      } else if (state === "signin") {
        box.append(signInButton(ctx, "🔔 Sign in for notifications"));
      } else if (state !== "unavailable") {
        box.append(h("span", "muted small-text", {
          denied: "Notifications blocked in Settings",
          install: "Install the app to get notifications",
        }[state]));
      }
    };
    draw();
  }

  function emptyText() {
    if (!data) return "Signals arrive with the next daily update.";
    if (which === "watchlist") return "Add stocks to the watchlist to see their signals here.";
    if (which === "tickers") return "No index tickers in config.json.";
    if (data.historyDays < MIN_DAYS) {
      return `Building price history for the Russell 2000: ${data.historyDays} of ${MIN_DAYS} days so far. Picks start once there's enough for the moving averages.`;
    }
    return which === "picks" ? `No strong buy signals among ${data.scanned.toLocaleString()} stocks today.`
      : `No strong sell signals among ${data.scanned.toLocaleString()} stocks today.`;
  }
}

/** RSI over 70 reads as overbought (red), under 30 as oversold (green). */
const rsiTone = (r) => (r == null ? "" : r > 70 ? "neg" : r < 30 ? "pos" : "");

function scoreCell(score) {
  const td = h("td");
  td.append(h("span", `score ${tone(score)}`, `${score > 0 ? "+" : ""}${score}`));
  return td;
}

/** The signals behind a score, as small tags. Also used on the ticker page. */
export function signalsCell(signals, tag = "td") {
  const el = h(tag, "left signals-col");
  const box = h("div", "signals");
  if (!signals?.length) box.append(h("span", "muted", "No signals"));
  for (const s of signals || []) box.append(h("span", `signal ${s.tone}`, s.text));
  el.append(box);
  return el;
}
