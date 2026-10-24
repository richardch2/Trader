// Boots the page: loads config.json and each fetcher's data, then mounts the
// cards listed in config.json in order. A card that fails shows an error in its
// own box and the rest of the page carries on.
import { createContext, RANGES, h } from "./core.js";
import { longDate } from "./lib/format.js";

const $ = (s) => document.querySelector(s);
const getJSON = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function boot() {
  const config = await getJSON("config.json");
  if (!config) return fail("Couldn't read config.json.");
  document.title = config.title ? config.title.replace(/^./, (c) => c.toUpperCase()) : document.title;
  $("#eyebrow").textContent = config.title || "";

  const fetchers = (config.fetchers || []).filter((f) => f.enabled !== false);
  const loaded = await Promise.all(fetchers.map((f) => getJSON(`data/${f.name}.json`)));
  const datasets = Object.fromEntries(fetchers.map((f, i) => [f.name, loaded[i]]));

  const hasPrices = Object.values(datasets.prices?.series || {}).some((s) => Object.keys(s).length);
  if (!hasPrices) {
    $("#headline").textContent = config.title || "";
    $("#empty").hidden = false;
    return;
  }

  const ctx = createContext(config, datasets);
  $("#updated").textContent = `Data through ${longDate(ctx.dates.at(-1))}`;
  const missed = fetchers.flatMap((f) => (datasets[f.name]?.failures || []).map((m) => m.split(":")[0]));
  if (missed.length) $("#failures").textContent = ` Last update missed: ${missed.join(", ")}.`;
  buildRanges(ctx);
  $("#cards").hidden = false;

  const mounted = [];
  for (const [i, opts] of (config.cards || []).entries()) {
    try {
      const mod = await import(`./cards/${opts.type}.js`);
      const card = mod.default(opts, ctx);
      const el = mod.slot === "header" ? $("#headline") : frame(opts, i);
      card.mount?.(el);
      mounted.push({ card, el, opts });
    } catch (e) {
      console.error(`Card "${opts.type}" failed:`, e);
      frame(opts, i).append(h("p", "card-error", `The "${opts.type}" card didn't load: ${e.message}`));
    }
  }

  const renderAll = () => {
    for (const m of mounted) {
      try { m.card.render(m.el); }
      catch (e) { console.error(`Card "${m.opts.type}" failed to draw:`, e); }
    }
  };
  ctx.onChange(() => { syncRanges(ctx); renderAll(); });
  renderAll();

  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderAll);
}

function frame(opts, i) {
  const el = h("section", `card span-${opts.width === "half" ? "half" : "full"}`);
  el.id = opts.id || `${opts.type}-${i}`;
  $("#cards").append(el);
  return el;
}

function buildRanges(ctx) {
  const box = $("#ranges");
  for (const r of RANGES) {
    const b = h("button", null, r.id);
    b.disabled = !ctx.rangeAvailable(r);
    b.addEventListener("click", () => ctx.set({ range: r.id }));
    box.append(b);
  }
  syncRanges(ctx);
}

function syncRanges(ctx) {
  $("#ranges").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === ctx.state.range)));
}

function fail(msg) {
  $("#headline").textContent = msg;
}

boot();
