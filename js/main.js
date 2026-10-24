// Boots the page: loads config.json and each fetcher's data, builds the menu from
// config.pages, and mounts the cards of whichever page the address points to
// (#overview, #watchlist, #ticker/IWM). A card that fails shows an error in its
// own box and the rest of the page carries on.
import { createContext, RANGES, h } from "./core.js";
import { longDate } from "./lib/format.js";

const $ = (s) => document.querySelector(s);
const getJSON = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const modules = {};
let ctx, pages, mounted = [];

async function boot() {
  const config = await getJSON("config.json");
  if (!config) return ($("#headline").textContent = "Couldn't read config.json.");
  const title = config.title || "";
  document.title = title.replace(/^./, (c) => c.toUpperCase());
  $("#brand").textContent = title;

  // older configs with a single "cards" list become one page
  pages = config.pages || [{ id: "overview", title: "Overview", cards: config.cards || [] }];

  const fetchers = (config.fetchers || []).filter((f) => f.enabled !== false);
  const loaded = await Promise.all(fetchers.map((f) => getJSON(`data/${f.name}.json`)));
  const datasets = Object.fromEntries(fetchers.map((f, i) => [f.name, loaded[i]]));

  const hasPrices = Object.values(datasets.prices?.series || {}).some((s) => Object.keys(s).length);
  if (!hasPrices) {
    $("#headline").textContent = title;
    $("#empty").hidden = false;
    return;
  }

  ctx = createContext(config, datasets);
  $("#updated").textContent = `Data through ${longDate(ctx.dates.at(-1))}`;
  const missed = fetchers.flatMap((f) => (datasets[f.name]?.failures || []).map((m) => m.split(":")[0]));
  if (missed.length) $("#failures").textContent = ` Last update missed: ${missed.join(", ")}.`;

  buildMenu();
  buildRanges();
  ctx.onChange(() => { syncRanges(); renderAll(); });
  addEventListener("hashchange", route);
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderAll);
  await route();
}

// ---------- pages ----------
function parseHash() {
  const [page, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { page: page || pages[0].id, arg: rest.join("/") || null };
}

async function route() {
  let { page: id, arg } = parseHash();
  let page = pages.find((p) => p.id === id);
  if (!page) { page = pages[0]; arg = null; }
  ctx.route = { page: page.id, arg };

  // menu: highlight the current page (a hidden page highlights its parent)
  // a ticker page belongs under Watchlist if the ticker is on the watchlist, else under the first page
  const parent = page.parent || (page.id === "ticker" && ctx.watchlist.some((w) => w.symbol === arg) ? "watchlist" : pages[0].id);
  const current = page.hidden ? parent : page.id;
  document.querySelectorAll("#menu a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.page === current));

  // page heading: the page's own text, unless a card renders into the header
  const hl = $("#headline");
  hl.replaceChildren();
  hl.textContent = page.heading || page.title;
  ctx.setHeading = (text) => { hl.textContent = text; };
  $("#ranges").hidden = page.ranges === false;

  const box = $("#cards");
  box.replaceChildren();
  box.hidden = false;
  mounted = [];
  for (const [i, opts] of (page.cards || []).entries()) {
    try {
      const mod = (modules[opts.type] ??= await import(`./cards/${opts.type}.js`));
      const card = mod.default(opts, ctx);
      const el = mod.slot === "header" ? hl : frame(opts, i);
      card.mount?.(el);
      mounted.push({ card, el, opts });
    } catch (e) {
      console.error(`Card "${opts.type}" failed:`, e);
      frame(opts, i).append(h("p", "card-error", `The "${opts.type}" card didn't load: ${e.message}`));
    }
  }
  renderAll();
  window.scrollTo({ top: 0 });
}

function renderAll() {
  for (const m of mounted) {
    try { m.card.render(m.el); }
    catch (e) { console.error(`Card "${m.opts.type}" failed to draw:`, e); }
  }
}

function frame(opts, i) {
  const el = h("section", `card span-${opts.width === "half" ? "half" : "full"}`);
  el.id = opts.id || `${opts.type}-${i}`;
  $("#cards").append(el);
  return el;
}

// ---------- menu and period buttons ----------
function buildMenu() {
  const menu = $("#menu");
  for (const p of pages.filter((p) => !p.hidden)) {
    const a = h("a", null, p.title);
    a.href = `#${p.id}`;
    a.dataset.page = p.id;
    menu.append(a);
  }
}

function buildRanges() {
  const box = $("#ranges");
  for (const r of RANGES) {
    const b = h("button", null, r.id);
    b.disabled = !ctx.rangeAvailable(r);
    b.addEventListener("click", () => ctx.set({ range: r.id }));
    box.append(b);
  }
  syncRanges();
}

function syncRanges() {
  $("#ranges").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === ctx.state.range)));
}

boot();
