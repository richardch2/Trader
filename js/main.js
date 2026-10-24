// Boots the page: loads config.json and each fetcher's data, builds the menu from
// config.pages, and mounts the cards of whichever page the address points to
// (#overview, #watchlist, #ticker/IWM). A card that fails shows an error in its
// own box and the rest of the page carries on.
import { createContext, RANGES, h } from "./core.js";
import { longDate } from "./lib/format.js";
import { connect } from "./lib/db.js";

const $ = (s) => document.querySelector(s);
const getJSON = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const modules = {};
let ctx, pages, mounted = [];
let config, datasets, db, staticWatchlist;

async function boot() {
  config = await getJSON("config.json");
  if (!config) return ($("#headline").textContent = "Couldn't read config.json.");
  const title = config.title || "";
  document.title = title.replace(/^./, (c) => c.toUpperCase());
  $("#brand").textContent = title;

  // older configs with a single "cards" list become one page
  pages = config.pages || [{ id: "overview", title: "Overview", cards: config.cards || [] }];

  const fetchers = (config.fetchers || []).filter((f) => f.enabled !== false);
  const [loaded, database] = await Promise.all([
    Promise.all(fetchers.map((f) => getJSON(`data/${f.name}.json`))),
    connect(config.supabase),
  ]);
  datasets = Object.fromEntries(fetchers.map((f, i) => [f.name, loaded[i]]));
  db = database;
  staticWatchlist = config.watchlist || [];

  const hasPrices = Object.values(datasets.prices?.series || {}).some((s) => Object.keys(s).length);
  if (!hasPrices) {
    $("#headline").textContent = title;
    $("#empty").hidden = false;
    return;
  }

  await buildContext();
  $("#updated").textContent = `Data through ${longDate(ctx.dates.at(-1))}`;
  const missed = fetchers.flatMap((f) => (datasets[f.name]?.failures || []).map((m) => m.split(":")[0]));
  if (missed.length) $("#failures").textContent = ` Last update missed: ${missed.join(", ")}.`;

  buildMenu();
  buildRanges();
  renderAccount();
  if (db.linkError) toast(`Sign-in link didn't work: ${db.linkError}. Request a new one from Sign in on the Picks page.`, true);
  else if (db.email && sessionStorage.getItem("welcomed") !== db.email) {
    try { sessionStorage.setItem("welcomed", db.email); } catch {}
    toast(`Signed in as ${db.email}.`);
  }
  db.onAuthChange(() => { renderAccount(); route(); });
  addEventListener("hashchange", route);
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderAll);
  await route();
}

// ---------- context and the hosted watchlist ----------
async function buildContext() {
  let rows = [];
  try { rows = await db.list(); }
  catch (e) { toast(`Couldn't load the watchlist: ${e.message}`, true); }
  // hosted rows first; stocks listed only in config.json stay as fixed entries
  const hosted = rows.map((r) => ({ ...r, hosted: true }));
  const watchlist = [...hosted, ...staticWatchlist.filter((w) => !hosted.some((r) => r.symbol === w.symbol))];
  const state = ctx?.state;
  ctx = createContext({ ...config, watchlist }, datasets);
  if (state) Object.assign(ctx.state, state);
  ctx.onChange(() => { syncRanges(); renderAll(); });
  ctx.db = db;
  ctx.toast = toast;
  ctx.onWatchlist = (sym) => ctx.watchlist.some((w) => w.symbol === sym);
  /** Add a stock to the hosted watchlist, then redraw the page. */
  ctx.addToWatchlist = async (item) => {
    await db.add(item);
    toast(`${item.symbol} added to the watchlist. Prices arrive with the next daily update.`);
    await buildContext();
    await route();
  };
  ctx.removeFromWatchlist = async (sym) => {
    await db.remove(sym);
    toast(`${sym} removed from the watchlist.`);
    await buildContext();
    await route();
  };
  /** Only hosted entries can be removed from the site. */
  ctx.canRemove = (sym) => db.canEdit && ctx.watchlist.some((w) => w.symbol === sym && w.hosted);
}

// ---------- account (who's signed in, in the footer; sign-in lives on the cards that need it) ----------
function renderAccount() {
  const box = $("#account");
  box.replaceChildren();
  if (!db.enabled || !db.email) return;
  const who = h("span", "account-who", `Signed in as ${db.email}.`);
  const out = h("button", "link-btn", "Sign out");
  out.addEventListener("click", () => db.signOut());
  box.append(who, " ", out);
}

let toastTimer;
function toast(text, isError = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3500);
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
  // a ticker page belongs under Watchlist if the ticker is on the watchlist, then Picks or Top 10 if listed there, else the first page
  const inTop = ctx.data.smallcaps?.gainers?.some((g) => g.symbol === arg) && pages.some((p) => p.id === "top10");
  const inPicks = [...(ctx.data.picks?.picks || []), ...(ctx.data.picks?.cautions || [])].some((r) => r.symbol === arg)
    && pages.some((p) => p.id === "picks");
  const parent = page.parent || (page.id !== "ticker" ? pages[0].id
    : ctx.watchlist.some((w) => w.symbol === arg) ? "watchlist" : inPicks ? "picks" : inTop ? "top10" : pages[0].id);
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

// ---------- install as an app (tablet, phone, desktop) ----------
function setupInstall() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Offline support unavailable:", e));
  }
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (installed) return;
  const btn = $("#install");
  let prompt = null;
  // Chrome, Edge and Android offer an install prompt the page can trigger
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e;
    btn.hidden = false;
  });
  addEventListener("appinstalled", () => { btn.hidden = true; prompt = null; });
  // iPhone and iPad have no prompt: point to Share → Add to Home Screen
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) btn.hidden = false;
  btn.addEventListener("click", async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") btn.hidden = true;
      prompt = null;
    } else if (ios) {
      toast("To install: tap the Share button, then Add to Home Screen.");
    }
  });
  if (!navigator.onLine) toast("You're offline. Showing the last saved data.");
}

setupInstall();
boot();
