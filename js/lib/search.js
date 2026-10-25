// Ticker search in the menu bar: type a symbol or a company or coin name and
// press Enter (or pick a suggestion) to open its page. Suggests the index ETFs,
// your lists, every Russell 2000 stock and common coins. Any other symbol still
// opens a page, where it can be added to a list.
import { h } from "../core.js";
import { COINS } from "../cards/addticker.js";

const SYMBOL = /^[A-Z^][A-Z0-9.\-=^]{0,11}$/;

/** [{symbol, name}] to suggest, without duplicates, your own lists first. */
function choices(ctx) {
  const out = new Map();
  const add = (symbol, name) => { if (symbol && !out.has(symbol)) out.set(symbol, name || ""); };
  for (const t of [...ctx.tickers, ...ctx.watchlist, ...ctx.list("crypto"), ...ctx.list("macro")]) add(t.symbol, t.name);
  for (const [s, n] of Object.entries(COINS)) add(s, n);
  for (const [s, [n]] of Object.entries(ctx.data.smallcaps?.members || {})) add(s, n);
  return [...out].map(([symbol, name]) => ({ symbol, name }));
}

/** Turn what was typed into a symbol: an exact symbol, a known name, or a coin like "BTC". */
function resolve(text, list) {
  const q = text.trim();
  if (!q) return null;
  const up = q.toUpperCase();
  if (list.some((c) => c.symbol === up)) return up;
  if (list.some((c) => c.symbol === `${up}-USD`)) return `${up}-USD`;
  const lower = q.toLowerCase();
  const byName = list.find((c) => c.name.toLowerCase() === lower) || list.find((c) => c.name.toLowerCase().startsWith(lower));
  if (byName) return byName.symbol;
  return SYMBOL.test(up) ? up : null;
}

/** current: () => the page context (it is rebuilt when the lists change). */
export function setupSearch(current) {
  const box = document.getElementById("search");
  if (!box || box.dataset.ready) return;
  box.dataset.ready = "1";

  const btn = h("button", "link-btn search-btn");
  btn.setAttribute("aria-label", "Search tickers");
  btn.title = "Search tickers";
  btn.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const panel = h("form", "search-panel");
  panel.hidden = true;
  const input = h("input", "search-input");
  Object.assign(input, { type: "search", placeholder: "Symbol or name, e.g. CROX, Bitcoin", autocomplete: "off", spellcheck: false });
  input.setAttribute("aria-label", "Symbol or company name");
  input.setAttribute("list", "search-symbols");
  input.enterKeyHint = "go";
  const msg = h("p", "search-msg");
  panel.append(input, msg);
  box.append(btn, panel);

  let list = [];
  const open = () => {
    list = choices(current());
    let dl = document.getElementById("search-symbols");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "search-symbols";
      document.body.append(dl);
    }
    dl.replaceChildren(...list.map((c) => {
      const o = document.createElement("option");
      o.value = c.symbol;
      o.label = c.name;
      return o;
    }));
    panel.hidden = false;
    msg.textContent = "";
    input.value = "";
    input.focus();
  };
  const close = () => { panel.hidden = true; };

  btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden ? open() : close(); });
  panel.addEventListener("submit", (e) => {
    e.preventDefault();
    const sym = resolve(input.value, list);
    if (!sym) { msg.textContent = "No match. Type a ticker symbol, e.g. CROX."; return; }
    close();
    location.hash = current().href(sym);
  });
  // picking a suggestion fills in an exact symbol: go straight there
  input.addEventListener("change", () => {
    const v = input.value.trim().toUpperCase();
    if (list.some((c) => c.symbol === v)) panel.requestSubmit();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
  addEventListener("hashchange", close);
}
