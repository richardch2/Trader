// Supabase Edge Function: delayed intraday quotes for the ticker pages.
//
// POST {"symbols": ["OCGN", "BTC-USD"]} → {"quotes": {"OCGN": {price, prevClose, change, time,
// state, delayMin}}, "failed": [...]}. Prices come from Yahoo Finance's chart endpoint (stocks
// about 15 minutes delayed, coins near real time). Answers are cached for 60 seconds per symbol,
// so many viewers cost Yahoo one request a minute per symbol. At most 10 symbols per call.
// Any visitor may call it with the site's public key; it only reads public prices.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=30" } });

const SYMBOL = /^[A-Z^][A-Z0-9.=^-]{0,11}$/;
const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  Accept: "application/json",
};
type Quote = { price: number; prevClose: number | null; change: number | null; time: string; state: string; delayMin: number };
const cache = new Map<string, { at: number; q: Quote }>();
const TTL = 60_000;

async function fetchQuote(sym: string): Promise<Quote> {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL) return hit.q;
  // Yahoo writes share classes with a dash (BRK-B)
  const ysym = sym.replace(/\.([A-Z])$/, "-$1");
  let last = "";
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(ysym)}?range=1d&interval=5m&includePrePost=false`, { headers: HEADERS });
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      const body = await res.json();
      const meta = body?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) { last = body?.chart?.error?.description || "no price"; continue; }
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const q: Quote = {
        price: meta.regularMarketPrice,
        prevClose: prev,
        change: prev ? meta.regularMarketPrice / prev - 1 : null,
        time: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
        state: meta.currentTradingPeriod ? marketState(meta) : "unknown",
        delayMin: sym.endsWith("-USD") ? 0 : (meta.exchangeDataDelayedBy ?? 15),
      };
      cache.set(sym, { at: Date.now(), q });
      return q;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last || "no answer");
}

/** "open" | "closed" from Yahoo's trading-period times (coins are always open). */
function marketState(meta: { instrumentType?: string; currentTradingPeriod?: { regular?: { start: number; end: number } } }) {
  if (meta.instrumentType === "CRYPTOCURRENCY") return "open";
  const r = meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  return r && now >= r.start && now < r.end ? "open" : "closed";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const asked: string[] = body.symbols || (url.searchParams.get("symbols") || "").split(",");
    const symbols = [...new Set(asked.map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL.test(s)))].slice(0, 10);
    if (!symbols.length) return json({ error: "send {\"symbols\": [\"OCGN\"]}" }, 400);
    const quotes: Record<string, Quote> = {};
    const failed: string[] = [];
    await Promise.all(symbols.map(async (s) => {
      try { quotes[s] = await fetchQuote(s); }
      catch (e) { failed.push(`${s}: ${e instanceof Error ? e.message : String(e)}`); }
    }));
    return json({ quotes, failed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
