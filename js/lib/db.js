// Hosted watchlist (Supabase). Everything here is optional: with no "supabase"
// settings in config.json the site falls back to the watchlist in config.json
// and hides the sign-in and Add buttons.
//
// Anyone can read and change the watchlist (see supabase/setup.sql). Signing in is
// only needed for notifications, which are kept per person.

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export async function connect(settings) {
  if (!settings?.url || !settings?.anonKey) return disabled();
  let client;
  try {
    const { createClient } = await import(CDN);
    client = createClient(settings.url, settings.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } });
  } catch (e) {
    console.error("Couldn't load the database client:", e);
    return disabled("Couldn't reach the database.");
  }

  // A sign-in link returns with #access_token=… (signs in whichever device opens it)
  // or #error=… (expired or already used). Read it before the page router sees it.
  const returned = new URLSearchParams(location.hash.slice(1));
  const linkError = returned.get("error_description");
  let session = (await client.auth.getSession()).data.session;
  if (returned.has("access_token") || returned.has("error")) history.replaceState(null, "", location.pathname + location.search + "#overview");
  const listeners = new Set();

  client.auth.onAuthStateChange(async (_event, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed) listeners.forEach((fn) => fn());
  });

  const fail = (error) => { throw new Error(error.message || String(error)); };

  return {
    enabled: true,
    /** Set when the page was opened from a sign-in link that didn't work. */
    linkError: linkError ? linkError.replace(/\+/g, " ") : null,
    get email() { return session?.user?.email || null; },
    /** Anyone can change the list. */
    get canEdit() { return true; },
    onAuthChange(fn) { listeners.add(fn); },

    /** Email a one-time sign-in link that returns to this page. */
    async signIn(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) fail(error);
    },
    async signOut() { await client.auth.signOut(); },

    /** [{symbol, name, note, source, added}] */
    async list() {
      const { data, error } = await client.from("watchlist").select("symbol,name,note,source,added").order("added");
      if (error) fail(error);
      return data;
    },
    async add({ symbol, name = null, note = null, source = "manual" }) {
      const { error } = await client.from("watchlist").insert({ symbol: symbol.toUpperCase(), name, note, source });
      if (error) fail(error.code === "23505" ? { message: `${symbol} is already on the watchlist.` } : error);
    },
    async remove(symbol) {
      const { error } = await client.from("watchlist").delete().eq("symbol", symbol);
      if (error) fail(error);
    },
    async setNote(symbol, note) {
      const { error } = await client.from("watchlist").update({ note: note || null }).eq("symbol", symbol);
      if (error) fail(error);
    },

    // ---------- push notifications (supabase/push.sql) ----------
    /** The sender's public key, or null if notifications aren't set up. */
    async pushKey() {
      const { data, error } = await client.rpc("push_public_key");
      return error ? null : data;
    },
    /** Save this device's subscription ({endpoint, keys: {p256dh, auth}}) for the signed-in person. */
    async savePush(sub) {
      const { error } = await client.from("push_subscriptions")
        .upsert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_id: session.user.id });
      if (error) fail(error);
    },
    async removePush(endpoint) {
      const { error } = await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) fail(error);
    },
    /** Ask the server to send a test notification to the signed-in person's devices. */
    async testPush() {
      const { data, error } = await client.functions.invoke("notify-picks", { body: { test: true } });
      if (error) fail(error);
      if (data?.error) fail({ message: data.error });
      return data;
    },
  };
}

function disabled(reason = null) {
  return {
    enabled: false,
    reason,
    email: null,
    canEdit: false,
    onAuthChange() {},
    async list() { return []; },
    async pushKey() { return null; },
  };
}
