// Hosted watchlist (Supabase). Everything here is optional: with no "supabase"
// settings in config.json the site falls back to the watchlist in config.json
// and hides the sign-in and Add buttons.
//
// Reading is public; adding and removing need an email sign-in by someone in the
// editors table (see supabase/setup.sql).

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export async function connect(settings) {
  if (!settings?.url || !settings?.anonKey) return disabled();
  let client;
  try {
    const { createClient } = await import(CDN);
    client = createClient(settings.url, settings.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  } catch (e) {
    console.error("Couldn't load the database client:", e);
    return disabled("Couldn't reach the database.");
  }

  let session = (await client.auth.getSession()).data.session;
  // a sign-in link returns with ?code=…; once exchanged, tidy the address
  if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + location.hash);
  let editor = session ? await checkEditor() : false;
  const listeners = new Set();

  async function checkEditor() {
    const { data, error } = await client.rpc("is_editor");
    return !error && data === true;
  }

  client.auth.onAuthStateChange(async (_event, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed) {
      editor = s ? await checkEditor() : false;
      listeners.forEach((fn) => fn());
    }
  });

  const fail = (error) => { throw new Error(error.message || String(error)); };

  return {
    enabled: true,
    get email() { return session?.user?.email || null; },
    /** Signed in and allowed to change the list. */
    get canEdit() { return editor; },
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
  };
}
