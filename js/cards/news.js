// Latest headlines for one ticker or coin (data/news.json, from Yahoo Finance).
// Options: symbol (default "$route"), title, count (default 5)
import { cardHead, h } from "../core.js";

/** "12 min ago", "3 h ago", "yesterday", "Oct 22" */
function ago(iso) {
  const mins = (Date.now() - Date.parse(iso)) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  if (mins < 48 * 60) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function news(opts, ctx) {
  const sym = ctx.resolve(opts.symbol || "$route");
  const count = opts.count || 5;
  let list;

  return {
    mount(el) {
      if (!sym || ctx.isMacro?.(sym)) { el.hidden = true; return; }
      cardHead(el, opts.title || "News", "Latest headlines from Yahoo Finance, updated with each data run.");
      list = h("ul", "news-list");
      el.append(list);
    },
    render() {
      if (!list) return;
      const items = ctx.data.news?.items?.[sym];
      list.replaceChildren();
      if (!items) {
        list.append(h("li", "card-empty", ctx.has(sym) || ctx.onWatchlist?.(sym)
          ? "Headlines arrive with the next data update."
          : "News is collected for stocks on your lists, picks and the top 10."));
        return;
      }
      if (!items.length) { list.append(h("li", "card-empty", "No headlines in the last two weeks.")); return; }
      for (const n of items.slice(0, count)) {
        const li = h("li", "news-item");
        const a = h("a", "news-title", n.title);
        Object.assign(a, { href: n.url, target: "_blank", rel: "noopener noreferrer" });
        const meta = h("div", "news-meta muted", [n.publisher, ago(n.time)].filter(Boolean).join(" · "));
        meta.title = new Date(n.time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
        li.append(a, meta);
        list.append(li);
      }
    },
  };
}
