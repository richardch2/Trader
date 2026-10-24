// Add any ticker to the hosted watchlist by hand, with suggestions from the
// Russell 2000 list and an optional note. Hidden when no database is set up.
// Options: title, note
import { cardHead, h } from "../core.js";

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export default function addticker(opts, ctx) {
  const members = ctx.data.smallcaps?.members || {};
  let form, hint, built = false;

  return {
    mount(el) {
      if (!ctx.db.enabled) { el.hidden = true; return; }
      cardHead(el, opts.title || "Add a ticker", opts.note || "Type a symbol or company name. Russell 2000 stocks are suggested; any US ticker works.");
      form = h("div", "add-form");
      built = false;
      hint = h("p", "add-hint");
      el.append(form, hint);
    },
    render(el) {
      if (!ctx.db.enabled) return;
      // build once, so typing survives redraws
      if (built) return;
      built = true;

      const listId = "r2k-symbols";
      let dl = document.getElementById(listId);
      if (!dl) {
        dl = document.createElement("datalist");
        dl.id = listId;
        for (const [sym, [name]] of Object.entries(members)) {
          const o = document.createElement("option");
          o.value = sym; o.label = name;
          dl.append(o);
        }
        document.body.append(dl);
      }

      const sym = h("input", "sym-input");
      Object.assign(sym, { placeholder: "Ticker, e.g. CROX", autocomplete: "off", spellcheck: false, maxLength: 10 });
      sym.setAttribute("list", listId);
      sym.setAttribute("aria-label", "Ticker");
      const note = h("input", "note-input");
      Object.assign(note, { placeholder: "Note (optional)", maxLength: 280 });
      note.setAttribute("aria-label", "Note");
      const add = h("button", "btn", "Add to watchlist");

      const check = () => {
        const s = sym.value.trim().toUpperCase();
        if (!s) { hint.textContent = ""; hint.className = "add-hint"; return null; }
        if (!SYMBOL.test(s)) { hint.textContent = "That doesn't look like a ticker symbol."; hint.className = "add-hint bad"; return null; }
        if (ctx.onWatchlist(s)) { hint.textContent = `${s} is already on the watchlist.`; hint.className = "add-hint bad"; return null; }
        const m = members[s];
        hint.textContent = m ? `${m[0]} · ${m[1]}` : `${s} isn't in the Russell 2000. It can still be added if it's a US-listed ticker.`;
        hint.className = "add-hint" + (m ? "" : " warn");
        return s;
      };
      sym.addEventListener("input", () => { sym.value = sym.value.toUpperCase(); check(); });

      const submit = async () => {
        const s = check();
        if (!s) { sym.focus(); return; }
        add.disabled = true; add.textContent = "Adding…";
        try {
          await ctx.addToWatchlist({ symbol: s, name: members[s]?.[0] || null, note: note.value.trim() || null, source: "manual" });
        } catch (e) {
          ctx.toast(e.message, true);
          add.disabled = false; add.textContent = "Add to watchlist";
        }
      };
      add.addEventListener("click", submit);
      for (const i of [sym, note]) i.addEventListener("keydown", (e) => e.key === "Enter" && submit());
      form.append(sym, note, add);
    },
  };
}
