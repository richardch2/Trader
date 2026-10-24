// Push notifications for new picks: subscribe this device, unsubscribe, and report
// what's possible here. The server side is supabase/push.sql and the notify-picks
// function; sw.js shows the notifications.

const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/**
 * What this device can do: "off" | "on" | "signin" | "denied" | "install" (iPhone/iPad
 * need the installed app) | "unavailable" (not set up, or the browser can't).
 */
export async function pushState(db) {
  if (!db.enabled || !(await db.pushKey())) return "unavailable";
  if (!supported()) return ios && !standalone ? "install" : "unavailable";
  if (Notification.permission === "denied") return "denied";
  if (!db.email) return "signin";
  return (await subscription()) ? "on" : "off";
}

async function subscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask permission and subscribe. Call straight from a tap: iOS requires it. */
export async function enablePush(db) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow them for this app in Settings.");
  const key = await db.pushKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) });
  await db.savePush(sub.toJSON());
}

export async function disablePush(db) {
  const sub = await subscription();
  if (!sub) return;
  await db.removePush(sub.endpoint);
  await sub.unsubscribe();
}

/** URL-safe base64 to bytes, for the server's public key. */
function bytes(b64) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
