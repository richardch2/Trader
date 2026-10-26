// Top gainers among Russell 2000 stocks, each with a button to add it to the hosted
// watchlist. While the market is open it shows today's movers (data/intraday.json,
// refreshed every 30 minutes); otherwise the last full day (data/smallcaps.json).
// Thinly traded stocks are left out; "Rel vol" is volume against the 20-day average.
// Options: title, note, count (default 10), band ("low" = only $1-$5 stocks),
// filter (true: an All / $1-$5 switch on the card, remembered on this device)
import { cardHead, h, addCell, symbolBadges, relVolCell, compactUsd } from "../core.js";
import { pct, money, tone, date } from "../lib/format.js";

/** Today's scan, if it is for a newer day than the last full ranking. */
export function liveMovers(ctx) {
  const live = ctx.data.intraday, daily = ctx.data.smallcaps;
  const day = daily?.rankedAsOf || daily?.asOf || "";
  return live?.marketDate && live.marketDate > day && live.gainers?.length ? live : null;
}

const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export default function topgainers(opts, ctx) {
  const count = opts.count || 10;
  let body, noteEl, titleEl, seg;
  let band = opts.band || "all";
  if (opts.filter) { try { band = localStorage.getItem("top10-band") || band; } catch {} }
  const card = {
    mount(el) {
      const head = cardHead(el, opts.title || "Top 10 small caps today", " ");
      noteEl = head.note;
      titleEl = head.title;
      if (opts.filter) {
        seg = h("div", "ranges seg");
        for (const [id, label] of [["all", "All"], ["low", "$1–$5"]]) {
          const b = h("button", null, label);
          b.dataset.band = id;
          b.addEventListener("click", () => {
            band = id;
            try { localStorage.setItem("top10-band", id); } catch {}
            card.render();
          });
          seg.append(b);
        }
        head.tools.append(seg);
      }
      body = h("div", "table-wrap");
      el.append(body);
    },
    render() {
      const daily = ctx.data.smallcaps;
      const live = liveMovers(ctx);
      const data = live || daily;
      const low = band === "low";
      seg?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.band === band)));
      const rows = ((low ? data?.gainersLow : data?.gainers) || []).slice(0, count);
      const priced = low ? " priced $1 to $5" : "";
      const floor = (low ? daily?.minDollarVol?.low : daily?.minDollarVol?.all);
      const liquid = floor ? ` Trading at least ${compactUsd(floor)} a day.` : "";

      titleEl.replaceChildren();
      if (live) titleEl.append(h("span", "live-dot"));
      titleEl.append(opts.title || "Top 10 small caps today");
      if (live) {
        noteEl.textContent = opts.note || `Live: Russell 2000 stocks${priced} up the most today, as of ${clock(live.asOf)} ET. Refreshes every 30 minutes while the market is open.${liquid}`;
      } else {
        const day = daily?.rankedAsOf || daily?.asOf;
        const when = day ? date(day, { weekday: "short", month: "short", day: "numeric" }) : null;
        noteEl.textContent = opts.note || (
          !daily ? "Russell 2000 rankings arrive with the next daily update."
          : daily.source === "holdings" || daily.source === "history"
            ? `Russell 2000 stocks${priced} up the most on ${when}${daily.prevAsOf ? ` (vs ${date(daily.prevAsOf)})` : ""}.${low ? "" : " Under $1 excluded."}${liquid}`
            : `Russell 2000 stocks among the whole market's top gainers on ${when}. The full ranking starts with the next daily update.`
        );
      }
      body.replaceChildren();
      if (!rows.length) {
        body.append(h("p", "card-empty", low && data?.gainers?.length
          ? "No $1–$5 stocks among the gainers. The list fills with the next update."
          : daily?.count
          ? `Tracking all ${daily.count.toLocaleString()} Russell 2000 stocks. The first full top 10 appears after the next daily update.`
          : "No ranking yet."));
        return;
      }

      const showAction = ctx.db.enabled;
      const hasVol = rows.some((r) => r.relVol != null);
      const table = document.createElement("table");
      table.className = "linked";
      const head = document.createElement("tr");
      for (const [label, cls] of [["#", "rank"], ["Ticker"], ["Name", "left hide-sm"], ["Sector", "left hide-md"], ["Price"], ["Change"],
        ...(hasVol ? [["Rel vol"], ["$ vol/day", "hide-md"]] : []), ...(showAction ? [["", "action"]] : [])]) {
        const th = h("th", cls, label);
        if (label === "Rel vol") th.title = live ? "Today's volume so far against the usual pace for this time of day" : "Volume against the 20-day average";
        if (label === "$ vol/day") th.title = "Average daily trading in dollars, last 20 sessions";
        head.append(th);
      }
      table.createTHead().append(head);
      const tbody = table.createTBody();
      rows.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.dataset.sym = r.symbol;
        const sym = h("td", "sym");
        const a = h("a", null, r.symbol); a.href = ctx.href(r.symbol);
        sym.append(a);
        symbolBadges(ctx, r.symbol, sym);
        tr.append(h("td", "rank muted", String(i + 1)), sym, h("td", "name left hide-sm", r.name), h("td", "muted left hide-md", r.sector),
          h("td", null, money(r.price)), h("td", tone(r.change), pct(r.change)));
        if (hasVol) tr.append(relVolCell(r.relVol), h("td", "hide-md muted", compactUsd(r.dollarVol)));
        if (showAction) tr.append(addCell(ctx, r, "top10"));
        tbody.append(tr);
      });
      table.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-sym]");
        if (row && !ev.target.closest("a, button")) location.hash = ctx.href(row.dataset.sym);
      });
      body.append(table);
    },
  };
  return card;
}
