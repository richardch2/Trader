// Supabase Edge Function: start a prices-only data update now, so a stock or coin
// just added to a list gets its chart in about 2 minutes instead of at the evening run.
//
// The site calls it after an editor adds something. It needs a GitHub token that may
// start the workflow, saved as the Edge Function secret GITHUB_DISPATCH_TOKEN
// (a fine-grained token for richardch2/Trader with "Actions: Read and write").
// Without that secret it answers {dispatched: false} and the site says prices come
// with the next daily update.
//
// Only editors can call it, and it asks GitHub at most once a minute; GitHub then
// queues one run at a time, so a burst of adds becomes one or two runs.
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "richardch2/Trader";
const WORKFLOW = "update-data.yml";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user?.email) return json({ dispatched: false, reason: "sign in first" }, 401);
    const { data: editor } = await db.from("editors").select("email").ilike("email", user.email).maybeSingle();
    if (!editor) return json({ dispatched: false, reason: "editors only" }, 403);

    const gh = Deno.env.get("GITHUB_DISPATCH_TOKEN");
    if (!gh) return json({ dispatched: false, reason: "not set up" });

    // at most once a minute: claim the slot first, so two adds at once make one request
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: claimed, error } = await db.from("push_state")
      .update({ last_dispatch: new Date().toISOString() }).eq("id", 1)
      .or(`last_dispatch.is.null,last_dispatch.lt.${since}`).select("id");
    if (error) throw error;
    if (!claimed?.length) return json({ dispatched: true, reason: "an update was just requested" });

    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gh}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "small-cap-tracker",
      },
      body: JSON.stringify({ ref: "main", inputs: { only: "prices picks earnings" } }),
    });
    if (res.status !== 204) {
      const text = await res.text();
      return json({ dispatched: false, reason: `GitHub answered ${res.status}: ${text.slice(0, 200)}` });
    }
    return json({ dispatched: true });
  } catch (e) {
    return json({ dispatched: false, reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
