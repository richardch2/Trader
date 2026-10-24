// Service worker: lets the site install as an app, open offline, and show
// notifications for new picks (sent by supabase/functions/notify-picks).
// Network first for everything on this site, so a new deploy or data update shows
// up straight away; the last good copy is served when the network is down.
// Other sites (fonts, the database) are left to the browser.
const CACHE = "small-cap-tracker-v1";
const SHELL = ["./", "index.html", "styles.css", "config.json", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});

// A push arrives as {title, body, url, tag}; url is relative to the app, e.g. "#picks".
self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || "Small Cap Tracker", {
    body: msg.body || "",
    tag: msg.tag,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: new URL(msg.url || "#picks", self.registration.scope).href },
  }));
});

// Tapping a notification opens the app at its page, reusing an open window if there is one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) return win.navigate(url).then((w) => (w || win).focus());
    return self.clients.openWindow(url);
  }));
});
