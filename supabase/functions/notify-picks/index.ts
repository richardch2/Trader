// Supabase Edge Function: the tracker's push notifications.
//
// Called every 15 minutes by pg_cron (see supabase/push.sql). Each run does three jobs,
// each sending at most once per thing, so calling it again (or by anyone) sends nothing twice:
//   1. New picks – to every subscribed device, when data/picks.json has a newer date.
//   2. Price alerts – each person's own alerts (public.alerts), checked once per new
//      data/prices.json. "above"/"below" fire once and turn off; "move" at most once a day.
//   3. Earnings reminders – the evening before (after 6pm New York time), to each person,
//      for watchlist stocks and their own positions reporting the next trading day.
//
// POST {"test": true} with a signed-in user's token instead sends a test
// notification to that user's own devices.
//
// The signing (VAPID) keys are made on the first run and kept in public.push_state,
// which only this function can read.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "richardch2/Trader";
const SITE = "https://richardch2.github.io/Trader/";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/data`;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; user_id?: string };
type Pick = { symbol: string; score: number; signals: { text: string }[] };
type State = {
  last_as_of: string | null; last_picks: string[];
  prices_checked: string | null; earnings_sent: string | null;
};
type Alert = { id: number; user_id: string; symbol: string; kind: "above" | "below" | "move"; value: number; fired_on: string | null };
type Bar = { c: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const state = await keys();
    webpush.setVapidDetails(SITE, state.vapid_public, state.vapid_private);
    if (body?.test) return json(await test(req));
    // each job reports on its own, so one failing doesn't stop the others
    const results: string[] = [];
    for (const [name, job] of [["picks", picks], ["alerts", alerts], ["earnings", earnings]] as const) {
      try { results.push(`${name}: ${await job(state)}`); }
      catch (e) { results.push(`${name} error: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return json(await record(results.join(" | ")));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await record(`error: ${message}`);
    return json({ error: message }, 500);
  }
});

/** The sender's state row, with signing keys made on first use. */
async function keys() {
  const { data, error } = await db.from("push_state").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data?.vapid_private) return data;
  const k = webpush.generateVAPIDKeys();
  const { data: row, error: e2 } = await db.from("push_state")
    .upsert({ id: 1, vapid_public: k.publicKey, vapid_private: k.privateKey }).select().single();
  if (e2) throw e2;
  return row;
}

async function record(result: string) {
  await db.from("push_state").update({ last_run: new Date().toISOString(), last_result: result.slice(0, 1000) }).eq("id", 1);
  return { result };
}

async function raw(name: string) {
  const res = await fetch(`${RAW}/${name}.json?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`);
  return res.json();
}

async function subscriptions(userId?: string): Promise<Sub[]> {
  let q = db.from("push_subscriptions").select("endpoint,p256dh,auth,user_id");
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

const href = (sym: string) => `#${sym.endsWith("-USD") ? "coin" : "ticker"}/${encodeURIComponent(sym)}`;
const money = (x: number) => x >= 1 ? x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : x.toLocaleString("en-US", { maximumSignificantDigits: 4 });

// ---------- 1. new picks ----------
async function picks(state: State) {
  const data = await raw("picks");
  const list: Pick[] = data.picks || [];
  if (!data.asOf || (state.last_as_of && data.asOf <= state.last_as_of)) return `nothing newer than ${state.last_as_of}`;

  // claim this day first, so an overlapping run can't send it too
  let claim = db.from("push_state").update({ last_as_of: data.asOf, last_picks: list.map((p) => p.symbol) }).eq("id", 1);
  claim = state.last_as_of ? claim.lt("last_as_of", data.asOf) : claim.is("last_as_of", null);
  const { data: claimed, error } = await claim.select("id");
  if (error) throw error;
  if (!claimed?.length) return `${data.asOf} already handled`;

  const fresh = list.filter((p) => !state.last_picks.includes(p.symbol));
  if (!fresh.length) return `no new picks on ${data.asOf}`;
  const names = fresh.slice(0, 5).map((p) => `${p.symbol} (+${p.score})`).join(", ");
  const more = fresh.length > 5 ? ` and ${fresh.length - 5} more` : "";
  const top = fresh[0].signals?.[0]?.text;
  const subs = await subscriptions();
  const { sent, gone } = await send(subs, {
    title: fresh.length === 1 ? `New pick: ${fresh[0].symbol}` : `${fresh.length} new picks`,
    body: `${names}${more}${top ? `\n${fresh[0].symbol}: ${top}` : ""}`,
    url: "#picks",
    tag: `picks-${data.asOf}`,
  });
  return `${data.asOf}: ${fresh.length} new, sent to ${sent} of ${subs.length} devices${gone ? `, ${gone} expired removed` : ""}`;
}

// ---------- 2. price alerts ----------
async function alerts(state: State) {
  const { data: active, error } = await db.from("alerts").select("id,user_id,symbol,kind,value,fired_on").eq("active", true);
  if (error) throw error;
  if (!active?.length) return "none set";
  const prices = await raw("prices");
  const updated: string = prices.updated || "";
  if (!updated || updated === state.prices_checked) return `${active.length} set, prices unchanged`;

  // claim this prices file, so an overlapping run can't fire the same alerts
  let claim = db.from("push_state").update({ prices_checked: updated }).eq("id", 1);
  claim = state.prices_checked ? claim.neq("prices_checked", updated) : claim.is("prices_checked", null);
  const { data: claimed, error: e2 } = await claim.select("id");
  if (e2) throw e2;
  if (!claimed?.length) return "prices already checked";

  const fired: { a: Alert; last: number; day: string; change: number | null }[] = [];
  for (const a of active as Alert[]) {
    const s: Record<string, Bar> = prices.series?.[a.symbol];
    if (!s) continue;
    const days = Object.keys(s).sort();
    const day = days.at(-1)!, last = s[day].c, prev = days.length > 1 ? s[days.at(-2)!].c : null;
    const change = prev ? last / prev - 1 : null;
    const value = Number(a.value);
    const hit = a.kind === "above" ? last >= value
      : a.kind === "below" ? last <= value
      : change != null && Math.abs(change) * 100 >= value && a.fired_on !== day;
    if (hit) fired.push({ a, last, day, change });
  }
  if (!fired.length) return `${active.length} checked, none hit`;

  let sent = 0;
  const now = new Date().toISOString();
  for (const { a, last, day, change } of fired) {
    // a one-time alert turns off before it's sent, so a retry can't send it twice
    const patch = a.kind === "move" ? { fired_on: day, fired_at: now, fired_price: last }
      : { active: false, fired_on: day, fired_at: now, fired_price: last };
    const { error: e3 } = await db.from("alerts").update(patch).eq("id", a.id);
    if (e3) throw e3;
    const pctText = change == null ? "" : ` (${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}% on the day)`;
    const title = a.kind === "above" ? `${a.symbol} closed above $${money(Number(a.value))}`
      : a.kind === "below" ? `${a.symbol} closed below $${money(Number(a.value))}`
      : `${a.symbol} ${change! > 0 ? "jumped" : "fell"} ${Math.abs(change! * 100).toFixed(1)}%`;
    const r = await send(await subscriptions(a.user_id), {
      title,
      body: `Closed at $${money(last)} on ${day}${a.kind === "move" ? "" : pctText}.${a.kind === "move" ? "" : " This alert is now off."}`,
      url: href(a.symbol),
      tag: `alert-${a.id}-${day}`,
    });
    sent += r.sent;
  }
  return `${fired.length} of ${active.length} fired, ${sent} notifications sent`;
}

// ---------- 3. earnings reminders ----------
function nyNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: parts.weekday as string };
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

async function earnings(state: State) {
  const now = nyNow();
  if (now.hour < 18) return "waits until 6pm New York time";
  if (state.earnings_sent === now.date) return `sent today`;
  if (now.weekday === "Sat" || now.weekday === "Sun") return "weekend";
  // reports on the next trading day: tomorrow, or Saturday to Monday from a Friday
  const targets = now.weekday === "Fri" ? [1, 2, 3].map((n) => addDays(now.date, n)) : [addDays(now.date, 1)];

  let claim = db.from("push_state").update({ earnings_sent: now.date }).eq("id", 1);
  claim = state.earnings_sent ? claim.lt("earnings_sent", now.date) : claim.is("earnings_sent", null);
  const { data: claimed, error } = await claim.select("id");
  if (error) throw error;
  if (!claimed?.length) return "already handled today";

  const cal = (await raw("earnings")).dates || {};
  const due = (sym: string) => targets.includes(cal[sym]?.date);
  const [{ data: watch }, { data: held }] = await Promise.all([
    db.from("watchlist").select("symbol"),
    db.from("positions").select("user_id,symbol"),
  ]);
  const shared = (watch || []).map((w) => w.symbol).filter(due);
  const subs = await subscriptions();
  const users = [...new Set(subs.map((s) => s.user_id!))];
  let people = 0, sent = 0;
  for (const user of users) {
    const own = (held || []).filter((p) => p.user_id === user).map((p) => p.symbol).filter(due);
    const syms = [...new Set([...own, ...shared])];
    if (!syms.length) continue;
    const when = (s: string) => cal[s].time === "pre-market" ? " (before the open)" : cal[s].time === "post-market" ? " (after the close)" : "";
    const label = targets.length > 1 ? "Earnings Monday" : "Earnings tomorrow";
    const r = await send(subs.filter((s) => s.user_id === user), {
      title: syms.length === 1 ? `${label}: ${syms[0]}` : `${label}: ${syms.length} of your stocks`,
      body: syms.slice(0, 6).map((s) => `${s}${when(s)}`).join(", ") + (syms.length > 6 ? ` and ${syms.length - 6} more` : ""),
      url: syms.length === 1 ? href(syms[0]) : "#portfolio",
      tag: `earnings-${now.date}`,
    });
    people++; sent += r.sent;
  }
  return people ? `reminded ${people} people (${sent} devices) for ${targets.join(", ")}` : `nothing due ${targets.join(", ")}`;
}

/** Test notification to the signed-in caller's own devices. */
async function test(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { error: "Sign in to send a test notification." };
  const subs = await subscriptions(user.id);
  const { sent } = await send(subs, {
    title: "Notifications are on",
    body: "You'll hear here about new picks, your price alerts and earnings dates.",
    url: "#picks",
    tag: "picks-test",
  });
  return { sent, devices: subs.length };
}

async function send(subs: Sub[], payload: Record<string, string>) {
  let sent = 0, gone = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {   // the device unsubscribed or the app was removed
        await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        gone++;
      } else console.error(`push to ${new URL(s.endpoint).host} failed:`, code, e);
    }
  }));
  return { sent, gone };
}
