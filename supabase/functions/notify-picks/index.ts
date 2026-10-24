// Supabase Edge Function: push a notification to every subscribed device when
// data/picks.json has new picks.
//
// Called every 15 minutes by pg_cron (see supabase/push.sql). It reads picks.json
// from the repo and only sends when the file's date is newer than the last
// notification, so calling it again, or by anyone, sends nothing twice.
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
const PICKS = `https://raw.githubusercontent.com/${REPO}/main/data/picks.json`;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string };
type Pick = { symbol: string; score: number; signals: { text: string }[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const state = await keys();
    webpush.setVapidDetails(SITE, state.vapid_public, state.vapid_private);
    return json(body?.test ? await test(req) : await notify(state));
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
  await db.from("push_state").update({ last_run: new Date().toISOString(), last_result: result }).eq("id", 1);
  return { result };
}

async function notify(state: { last_as_of: string | null; last_picks: string[] }) {
  const res = await fetch(`${PICKS}?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`picks.json: HTTP ${res.status}`);
  const data = await res.json();
  const picks: Pick[] = data.picks || [];
  if (!data.asOf || (state.last_as_of && data.asOf <= state.last_as_of)) return record(`nothing newer than ${state.last_as_of}`);

  // claim this day first, so an overlapping run can't send it too
  let claim = db.from("push_state").update({ last_as_of: data.asOf, last_picks: picks.map((p) => p.symbol) }).eq("id", 1);
  claim = state.last_as_of ? claim.lt("last_as_of", data.asOf) : claim.is("last_as_of", null);
  const { data: claimed, error } = await claim.select("id");
  if (error) throw error;
  if (!claimed?.length) return record(`${data.asOf} already handled`);

  const fresh = picks.filter((p) => !state.last_picks.includes(p.symbol));
  if (!fresh.length) return record(`no new picks on ${data.asOf}`);
  const names = fresh.slice(0, 5).map((p) => `${p.symbol} (+${p.score})`).join(", ");
  const more = fresh.length > 5 ? ` and ${fresh.length - 5} more` : "";
  const top = fresh[0].signals?.[0]?.text;
  const payload = {
    title: fresh.length === 1 ? `New pick: ${fresh[0].symbol}` : `${fresh.length} new picks`,
    body: `${names}${more}${top ? `\n${fresh[0].symbol}: ${top}` : ""}`,
    url: "#picks",
    tag: `picks-${data.asOf}`,
  };
  const { data: subs, error: e2 } = await db.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (e2) throw e2;
  const { sent, gone } = await send(subs || [], payload);
  return record(`${data.asOf}: ${fresh.length} new picks, sent to ${sent} of ${(subs || []).length} devices${gone ? `, ${gone} expired removed` : ""}`);
}

/** Test notification to the signed-in caller's own devices. */
async function test(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { error: "Sign in to send a test notification." };
  const { data: subs, error } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", user.id);
  if (error) throw error;
  const { sent } = await send(subs || [], {
    title: "Notifications are on",
    body: "You'll hear here when there are new picks after the daily update.",
    url: "#picks",
    tag: "picks-test",
  });
  return { sent, devices: (subs || []).length };
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
