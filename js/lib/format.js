// Number and date formatting shared by every card.

const ok = (x) => x != null && isFinite(x);

export const pct = (x, signed = true) =>
  ok(x) ? `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—";

export const pts = (x, signed = true) =>
  ok(x) ? `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pts` : "—";

export const money = (x) =>
  !ok(x) ? "—"
    // coins under a dollar (DOGE, SHIB…) need more than two decimals to show anything
    : Math.abs(x) > 0 && Math.abs(x) < 1 ? x.toLocaleString("en-US", { maximumSignificantDigits: 4, minimumSignificantDigits: 2 })
    : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const compact = (x) =>
  ok(x) ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x) : "—";

/** CSS class for a signed value: "pos", "neg" or "". */
export const tone = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");

export const date = (d, opts = { month: "short", day: "numeric" }) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

export const longDate = (d) => date(d, { month: "short", day: "numeric", year: "numeric" });
