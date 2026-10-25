// Price alerts, private to the signed-in person, sent as push notifications by the
// notify-picks function after each data update (supabase/alerts-positions.sql).
//   above / below – a daily close at or past a price; fires once, then turns off
//   move          – a day's change of at least N%, up or down; fires at most once a day
// Options: title, note, symbol ("$route" on ticker pages: that symbol only, with its
// price filled in; leave it out for every alert with a symbol box)
import { cardHead, h, isCrypto } from "../core.js";
import { money, date } from "../lib/format.js";
import { pushState, enablePush } from "../lib/push.js";

const SYMBOL = /^[A-Z^][A-Z0-9.=^-]{0,11}$/;
const KIND_LABEL = { above: "Closes above", below: "Closes below", move: "Moves at least" };

/** "Closes above $2.00" / "Moves at least 8% in a day" */
export function describe(a) {
  return a.kind === "move" ? `Moves at least ${Number(a.value)}% in a day` : `${KIND_LABEL[a.kind]} $${money(Number(a.value))}`;
}

export default function alerts(opts, ctx) {
  const fixed = opts.symbol ? ctx.resolve(opts.symbol) : null;
  let body, builtFor = null;

  async function pushLine() {
    const line = h("p", "alert-push muted");
    const state = await pushState(ctx.db).catch(() => "unavailable");
    if (state === "on") return null;
    const text = {
      off: "Alerts arrive as notifications on this device. ",
      denied: "Notifications are blocked for this app in Settings, so alerts can't reach this device.",
      install: "On iPhone and iPad, install the app (Share → Add to Home Screen) to get alert notifications.",
      unavailable: "This browser can't show notifications; alerts still show here once they fire.",
      signin: "",
    }[state];
    line.append(text);
    if (state === "off") {
      const b = h("button", "link-btn accent-link", "Turn on notifications");
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await enablePush(ctx.db); ctx.toast("Notifications are on for this device."); line.remove(); }
        catch (e) { ctx.toast(e.message, true); b.disabled = false; }
      });
      line.append(b);
    }
    return line;
  }

  function form() {
    const f = h("form", "alert-form");
    const sym = h("input", "sym-input");
    Object.assign(sym, { placeholder: "Symbol", autocomplete: "off", spellcheck: false, maxLength: 12 });
    sym.setAttribute("aria-label", "Symbol");
    const kind = document.createElement("select");
    kind.setAttribute("aria-label", "Alert type");
    for (const [v, label] of [["above", "Closes above $"], ["below", "Closes below $"], ["move", "Day move ≥ %"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = label; kind.append(o);
    }
    const value = h("input", "alert-value");
    Object.assign(value, { type: "number", inputMode: "decimal", step: "any", min: "0", placeholder: "Price" });
    value.setAttribute("aria-label", "Value");
    const add = h("button", "btn", "Add alert");
    add.type = "submit";

    // suggest a value: 10% above or below the last close, or a 5% move
    const suggest = () => {
      const s = fixed || sym.value.trim().toUpperCase();
      const last = s ? ctx.lastClose(s) : null;
      value.placeholder = kind.value === "move" ? "%" : "Price";
      if (kind.value === "move") value.value = "5";
      else if (last) {
        const v = last * (kind.value === "above" ? 1.1 : 0.9);
        value.value = v >= 1 ? v.toFixed(2) : Number(v.toPrecision(3)).toString();
      } else value.value = "";
    };
    kind.addEventListener("change", suggest);
    sym.addEventListener("change", () => { sym.value = sym.value.trim().toUpperCase(); suggest(); });

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      let s = fixed || sym.value.trim().toUpperCase();
      if (!fixed && !ctx.has(s) && ctx.has(`${s}-USD`)) s = `${s}-USD`;   // "BTC" means the coin
      const v = Number(value.value);
      if (!SYMBOL.test(s)) { ctx.toast("Enter a ticker symbol.", true); sym.focus(); return; }
      if (!(v > 0)) { ctx.toast("Enter a value above zero.", true); value.focus(); return; }
      add.disabled = true;
      try {
        await ctx.changePrivate((db) => db.addAlert({ symbol: s, kind: kind.value, value: v }),
          `Alert set: ${s} ${describe({ kind: kind.value, value: v }).toLowerCase()}.${ctx.has(s) ? "" : ` ${s} isn't tracked yet, so add it to a list for prices.`}`);
      } catch (err) { ctx.toast(err.message, true); add.disabled = false; }
    });

    if (!fixed) f.append(sym);
    f.append(kind, value, add);
    suggest();
    return f;
  }

  function row(a) {
    const li = h("li", "alert-row" + (a.active ? "" : " fired"));
    const what = h("span", "alert-what");
    if (!fixed) {
      const link = h("a", "sym", a.symbol);
      link.href = ctx.href(a.symbol);
      what.append(link, " ");
    }
    what.append(describe(a));
    const status = h("span", "alert-status muted", a.active
      ? (a.fired_at ? `last fired ${date(a.fired_at.slice(0, 10))}` : `set ${date(a.created_at.slice(0, 10))}`)
      : `fired ${date(a.fired_at.slice(0, 10))} at ${money(Number(a.fired_price))}`);
    const del = h("button", "btn small ghost", a.active ? "Remove" : "Clear");
    del.addEventListener("click", async () => {
      del.disabled = true;
      try { await ctx.changePrivate((db) => db.removeAlert(a.id)); }
      catch (e) { ctx.toast(e.message, true); del.disabled = false; }
    });
    li.append(what, status, del);
    return li;
  }

  return {
    mount(el) {
      if (!ctx.db.enabled || (fixed && ctx.isMacro?.(fixed))) { el.hidden = true; return; }
      cardHead(el, opts.title || (fixed ? "Alerts" : "Price alerts"), opts.note ||
        `Checked after each data update${fixed && isCrypto(fixed) ? ", including weekends" : ""}; only you see your alerts.`);
      body = h("div", "alerts-body");
      el.append(body);
    },
    async render() {
      if (!body) return;
      const mine = (ctx.alerts || []).filter((a) => !fixed || a.symbol === fixed);
      const key = `${ctx.db.email}|${mine.map((a) => `${a.id}:${a.active}`).join(",")}`;
      if (builtFor === key) return;   // keep what's typed through redraws
      builtFor = key;
      body.replaceChildren();
      if (!ctx.db.email) {
        body.append(h("p", "card-empty", "Sign in (top right) to set price alerts. Any email works; your alerts are private."));
        return;
      }
      const list = h("ul", "alert-list");
      list.append(...mine.sort((a, b) => Number(b.active) - Number(a.active)).map(row));
      if (!mine.length) body.append(h("p", "card-empty", fixed ? `No alerts on ${fixed} yet.` : "No alerts yet. Add one below, or from any ticker's page."));
      body.append(list, form());
      const line = await pushLine();
      if (line && builtFor === key) body.append(line);
    },
  };
}
