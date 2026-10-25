// Your positions: shares and average cost per stock or coin, valued at the latest close.
// Private to the signed-in person (supabase/alerts-positions.sql). Adding a position in
// something no list tracks also adds it to the watchlist or Crypto, so it gets prices.
// Options: title, note
import { cardHead, h, isCrypto, earningsBadge } from "../core.js";
import { money, pct, tone } from "../lib/format.js";
import { COINS } from "./addticker.js";

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,11}$/;
/** Dollars; amounts of $1,000 or more drop the cents so the table fits a phone. */
const dollars = (x) => (Math.abs(x) >= 1000 ? Math.round(Math.abs(x)).toLocaleString("en-US") : money(Math.abs(x)));
const usd = (x) => (x == null || !isFinite(x) ? "—" : `${x < 0 ? "−" : ""}$${dollars(x)}`);
const signedUsd = (x) => (x == null || !isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}$${dollars(x)}`);
const exact = (x) => `$${money(x)}`;   // per-share prices and costs keep their cents
const qty = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });

export default function positions(opts, ctx) {
  let summary, tableWrap, formBox, builtFor = null;
  let editing = null;   // the symbol whose row filled the form

  /** Each position with its price, value, day change and gain (nulls while prices are missing). */
  function rows() {
    return (ctx.positions || []).map((p) => {
      const s = ctx.series(p.symbol);
      const price = s.at(-1)?.c ?? null, prev = s.at(-2)?.c ?? null;
      const shares = Number(p.shares), cost = Number(p.cost);
      const value = price != null ? price * shares : null;
      const basis = cost * shares;
      return {
        ...p, shares, cost, price, value, basis,
        day: price != null && prev != null ? (price - prev) * shares : null,
        dayPct: price != null && prev ? price / prev - 1 : null,
        gain: value != null ? value - basis : null,
        gainPct: value != null && basis > 0 ? value / basis - 1 : null,
      };
    });
  }

  function drawSummary(list) {
    const priced = list.filter((r) => r.value != null);
    const value = priced.reduce((t, r) => t + r.value, 0);
    const basis = priced.reduce((t, r) => t + r.basis, 0);
    const day = priced.reduce((t, r) => t + (r.day || 0), 0);
    const gain = value - basis;
    const items = [
      ["Value", usd(value), `${priced.length} of ${list.length} priced`],
      ["Day", signedUsd(day), pct(value - day ? day / (value - day) : null), day],
      ["Total gain", signedUsd(gain), pct(basis ? gain / basis : null), gain],
      ["Cost basis", usd(basis), null],
    ];
    summary.replaceChildren(...items.map(([label, v, sub, signed]) => {
      const s = h("div", "stat");
      s.append(h("div", "stat-label", label), h("div", "stat-value " + (signed != null ? tone(signed) : ""), v));
      if (sub) s.append(h("div", "stat-sub", sub));
      return s;
    }));
    return value;
  }

  function drawTable(list, total) {
    const tbl = document.createElement("table");
    tbl.className = "linked positions";
    const head = document.createElement("tr");
    for (const [label, cls] of [["Symbol"], ["Shares", "hide-sm"], ["Avg cost", "hide-sm"], ["Price", "hide-sm"], ["Value"], ["Day"], ["Gain"], ["Weight", "hide-md"]]) {
      head.append(h("th", cls || null, label));
    }
    tbl.createTHead().append(head);
    const body = tbl.createTBody();
    for (const r of list.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))) {
      const tr = document.createElement("tr");
      tr.dataset.sym = r.symbol;
      const sym = h("td", "sym");
      const a = h("a", null, r.symbol); a.href = ctx.href(r.symbol);
      sym.append(a);
      const eb = earningsBadge(ctx, r.symbol); if (eb) sym.append(eb);
      const gain = h("td", tone(r.gain));
      gain.append(signedUsd(r.gain), h("div", "cell-sub", pct(r.gainPct)));
      const day = h("td", tone(r.day));
      day.append(signedUsd(r.day), h("div", "cell-sub", pct(r.dayPct)));
      tr.title = `Edit ${r.symbol}`;
      tr.append(sym, h("td", "hide-sm", qty(r.shares)), h("td", "hide-sm", exact(r.cost)));
      if (r.price == null) {
        const w = h("td", "waiting", "Prices arrive with the next update");
        w.colSpan = 5;   // the hidden columns don't count on a phone, which is fine for a spanning cell
        tr.append(w);
      } else {
        tr.append(h("td", "hide-sm", exact(r.price)), h("td", null, usd(r.value)), day, gain,
          h("td", "hide-md", total ? pct(r.value / total, false) : "—"));
      }
      body.append(tr);
    }
    // tapping a row edits it; the symbol itself links to its page
    tbl.addEventListener("click", (ev) => {
      const row = ev.target.closest("tr[data-sym]");
      if (!row || ev.target.closest("a, button")) return;
      const r = list.find((x) => x.symbol === row.dataset.sym);
      if (r) { editing = r.symbol; fillForm(r); }
    });
    const wrap = h("div", "table-wrap");
    wrap.append(tbl);
    tableWrap.replaceChildren(wrap);
  }

  let fields = null;
  function fillForm(r) {
    if (!fields) return;
    fields.sym.value = r.symbol; fields.sym.readOnly = true;
    fields.shares.value = r.shares; fields.cost.value = r.cost;
    fields.save.textContent = "Save changes";
    fields.remove.hidden = false; fields.cancel.hidden = false;
    fields.shares.focus();
    formBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function drawForm() {
    const f = h("form", "position-form");
    const sym = h("input", "sym-input");
    Object.assign(sym, { placeholder: "Symbol, e.g. OCGN or BTC", autocomplete: "off", spellcheck: false, maxLength: 12 });
    sym.setAttribute("aria-label", "Symbol");
    sym.setAttribute("list", "search-symbols");
    const shares = h("input");
    Object.assign(shares, { type: "number", inputMode: "decimal", step: "any", min: "0", placeholder: "Shares or coins" });
    shares.setAttribute("aria-label", "Shares or coins");
    const cost = h("input");
    Object.assign(cost, { type: "number", inputMode: "decimal", step: "any", min: "0", placeholder: "Avg cost each, $" });
    cost.setAttribute("aria-label", "Average cost per share, dollars");
    const save = h("button", "btn", "Add position"); save.type = "submit";
    const remove = h("button", "btn ghost", "Remove"); remove.type = "button"; remove.hidden = true;
    const cancel = h("button", "link-btn", "Cancel"); cancel.type = "button"; cancel.hidden = true;
    fields = { sym, shares, cost, save, remove, cancel };

    const reset = () => {
      editing = null; f.reset(); sym.readOnly = false;
      save.textContent = "Add position"; remove.hidden = cancel.hidden = true;
    };
    cancel.addEventListener("click", reset);
    remove.addEventListener("click", async () => {
      const p = (ctx.positions || []).find((x) => x.symbol === editing);
      if (!p || !confirm(`Remove your ${p.symbol} position?`)) return;
      remove.disabled = true;
      try { await ctx.changePrivate((db) => db.removePosition(p.id), `${p.symbol} position removed.`); }
      catch (e) { ctx.toast(e.message, true); remove.disabled = false; }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      let s = sym.value.trim().toUpperCase();
      // "BTC" means the coin when there's no stock by that name on any list
      if (!editing && !ctx.has(s) && (COINS[`${s}-USD`] || ctx.has(`${s}-USD`))) s = `${s}-USD`;
      const n = Number(shares.value), c = Number(cost.value || 0);
      if (!SYMBOL.test(s)) { ctx.toast("Enter a ticker symbol.", true); sym.focus(); return; }
      if (!(n > 0)) { ctx.toast("Enter how many shares or coins you hold.", true); shares.focus(); return; }
      if (!(c >= 0)) { ctx.toast("Enter the average cost per share.", true); cost.focus(); return; }
      save.disabled = true;
      try {
        // something no list tracks needs prices: put it on the watchlist or Crypto (editors only)
        const tracked = ctx.ticker(s) || ctx.has(s);
        let extra = "";
        if (!tracked) {
          if (ctx.db.canEdit) {
            await ctx.addToWatchlist({ symbol: s, name: ctx.data.smallcaps?.members?.[s]?.[0] || COINS[s] || null, source: "manual" }, { quiet: true });
            extra = ` Added to ${isCrypto(s) ? "Crypto" : "the watchlist"} for prices.`;
          } else extra = ` ${s} isn't tracked, so it shows no price until an editor adds it to a list.`;
        }
        const was = editing;
        await ctx.changePrivate((db) => db.savePosition({ symbol: s, shares: n, cost: c }),
          `${was ? "Updated" : "Saved"} ${qty(n)} ${s} at ${exact(c)}.${extra}`);
        reset();
      } catch (err) { ctx.toast(err.message, true); }
      finally { save.disabled = false; }
    });
    f.append(sym, shares, cost, save, remove, cancel);
    formBox.replaceChildren(f, h("p", "add-hint", "Tap a row to change or remove it. Adding a symbol you already hold replaces its shares and cost."));
  }

  return {
    mount(el) {
      if (!ctx.db.enabled) { el.hidden = true; return; }
      cardHead(el, opts.title || "Positions", opts.note || "Only you can see your positions. Values use the latest daily close.");
      summary = h("div", "stats");
      tableWrap = h("div");
      formBox = h("div");
      el.append(summary, tableWrap, formBox);
    },
    render() {
      if (!summary) return;
      if (!ctx.db.email) {
        summary.hidden = true;
        tableWrap.replaceChildren(h("p", "card-empty", "Sign in (top right) to track what you hold: value, day change and total gain. Any email works, and only you can see your positions."));
        formBox.replaceChildren();
        builtFor = null;
        return;
      }
      const list = rows();
      summary.hidden = !list.length;
      const total = list.length ? drawSummary(list) : 0;
      if (list.length) drawTable(list, total);
      else tableWrap.replaceChildren(h("p", "card-empty", "No positions yet. Add what you hold below."));
      // the form is built once per sign-in, so typing survives redraws
      if (builtFor !== ctx.db.email) { builtFor = ctx.db.email; drawForm(); }
    },
  };
}
