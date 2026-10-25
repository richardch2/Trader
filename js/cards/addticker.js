// Add any ticker to the hosted watchlist by hand, with suggestions from the
// Russell 2000 list and an optional note. Hidden when no database is set up.
// Options: title, note, list ("watchlist" default, or "crypto" to add coins such as SOL-USD)
import { cardHead, h, isCrypto } from "../core.js";

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
// suggestions for the coin form; any coin Yahoo Finance lists against the dollar works
const COINS = {
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana", "XRP-USD": "XRP", "BNB-USD": "BNB",
  "DOGE-USD": "Dogecoin", "ADA-USD": "Cardano", "TRX-USD": "TRON", "AVAX-USD": "Avalanche", "LINK-USD": "Chainlink",
  "DOT-USD": "Polkadot", "LTC-USD": "Litecoin", "BCH-USD": "Bitcoin Cash", "XLM-USD": "Stellar", "HBAR-USD": "Hedera",
  "SHIB-USD": "Shiba Inu", "ATOM-USD": "Cosmos", "NEAR-USD": "NEAR Protocol",
  "AAVE-USD": "Aave", "XMR-USD": "Monero", "ETC-USD": "Ethereum Classic", "FIL-USD": "Filecoin", "ALGO-USD": "Algorand",
};

export default function addticker(opts, ctx) {
  const coins = opts.list === "crypto";
  const members = coins ? Object.fromEntries(Object.entries(COINS).map(([s, n]) => [s, [n, "Crypto"]])) : ctx.data.smallcaps?.members || {};
  let form, hint, builtFor = null;

  return {
    mount(el) {
      if (!ctx.db.enabled) { el.hidden = true; return; }
      cardHead(el, opts.title || (coins ? "Add a coin" : "Add a ticker"), opts.note || (coins
        ? "Type a coin's symbol, e.g. SOL. Prices are in US dollars from Yahoo Finance."
        : "Type a symbol or company name. Russell 2000 stocks are suggested; any US ticker works."));
      form = h("div", "add-form");
      hint = h("p", "add-hint");
      el.append(form, hint);
    },
    render(el) {
      if (!ctx.db.enabled) return;
      // rebuild only when sign-in changes, so typing survives redraws
      const key = `${ctx.db.email}|${ctx.db.canEdit}`;
      if (builtFor === key) return;
      builtFor = key;
      form.replaceChildren();
      hint.textContent = "";
      if (!ctx.db.canEdit) {
        form.append(h("p", "card-empty", ctx.db.email
          ? `Signed in as ${ctx.db.email}, which isn't on the editors list.`
          : `Sign in (top right) to add ${coins ? "coins" : "stocks"}.`));
        return;
      }

      const listId = coins ? "coin-symbols" : "r2k-symbols";
      let dl = document.getElementById(listId);
      if (!dl) {
        dl = document.createElement("datalist");
        dl.id = listId;
        for (const [sym, [name]] of Object.entries(members)) {
          const o = document.createElement("option");
          o.value = coins ? sym.replace(/-USD$/, "") : sym; o.label = name;
          dl.append(o);
        }
        document.body.append(dl);
      }

      const sym = h("input", "sym-input");
      Object.assign(sym, { placeholder: coins ? "Coin, e.g. SOL" : "Ticker, e.g. CROX", autocomplete: "off", spellcheck: false, maxLength: 10 });
      sym.setAttribute("list", listId);
      sym.setAttribute("aria-label", "Ticker");
      const note = h("input", "note-input");
      Object.assign(note, { placeholder: "Note (optional)", maxLength: 280 });
      note.setAttribute("aria-label", "Note");
      const label = coins ? "Add coin" : "Add to watchlist";
      const add = h("button", "btn", label);

      const check = () => {
        let s = sym.value.trim().toUpperCase();
        if (!s) { hint.textContent = ""; hint.className = "add-hint"; return null; }
        if (coins) s = s.replace(/-?USDT?$/, "") + "-USD";   // SOL, SOLUSD and SOL-USD all mean SOL-USD
        if (!SYMBOL.test(s)) { hint.textContent = `That doesn't look like a ${coins ? "coin" : "ticker"} symbol.`; hint.className = "add-hint bad"; return null; }
        if (!coins && isCrypto(s)) { hint.textContent = "That's a coin. Add it on the Crypto page."; hint.className = "add-hint bad"; return null; }
        if (ctx.onWatchlist(s)) { hint.textContent = `${s} is already on ${coins ? "the crypto list" : "the watchlist"}.`; hint.className = "add-hint bad"; return null; }
        const m = members[s];
        hint.textContent = m ? `${m[0]} · ${coins ? s : m[1]}`
          : coins ? `Will track ${s}. Check the symbol: if Yahoo Finance doesn't list it, no prices will arrive.`
          : `${s} isn't in the Russell 2000. It can still be added if it's a US-listed ticker.`;
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
          add.disabled = false; add.textContent = label;
        }
      };
      add.addEventListener("click", submit);
      for (const i of [sym, note]) i.addEventListener("keydown", (e) => e.key === "Enter" && submit());
      form.append(sym, note, add);
    },
  };
}
