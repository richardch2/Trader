// One-sentence takeaway at the top of the page: primary ticker vs the benchmark.
// Options: a (default config.primary), b (default config.benchmark), aName, bName
import { pct } from "../lib/format.js";
import { h } from "../core.js";

export const slot = "header";

export default function headline(opts, ctx) {
  const a = opts.a || ctx.primary;
  const b = opts.b || ctx.benchmark;
  const aName = opts.aName || "small caps";
  const bName = opts.bName || "the S&P 500";

  return {
    render(el) {
      el.replaceChildren();
      const ra = ctx.rebased(a).at(-1)?.v;
      const rb = ctx.rebased(b).at(-1)?.v;
      if (ra == null || rb == null) { el.textContent = ctx.config.title || ""; return; }
      // compare the rounded figures shown, so the gap always matches them
      const r1 = (x) => Math.round(x * 1000) / 1000;
      const gap = r1(ra) - r1(rb);
      el.append(
        `Over the ${ctx.range().word}, ${aName} are `,
        h("span", ra > 0 ? "pos" : ra < 0 ? "neg" : "", pct(ra)),
        ` against ${pct(rb)} for ${bName}, ${gap >= 0 ? "leading" : "trailing"} by `,
        h("span", gap > 0 ? "pos" : gap < 0 ? "neg" : "", `${Math.abs(gap * 100).toFixed(1)} pts`),
        "."
      );
    },
  };
}
