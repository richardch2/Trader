(() => {
  const RANGES = [
    { id: "1M", days: 21 },
    { id: "3M", days: 63 },
    { id: "6M", days: 126 },
    { id: "1Y", days: 252 },
    { id: "All", days: Infinity },
  ];
  const COLS = [
    { key: "d1", label: "1D", days: 1 },
    { key: "w1", label: "1W", days: 5 },
    { key: "m1", label: "1M", days: 21 },
    { key: "m3", label: "3M", days: 63 },
  ];
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (s) => document.querySelector(s);
  const pct = (x, signed = true) =>
    x == null || !isFinite(x) ? "—" : `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const pts = (x) => (x == null || !isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`);
  const money = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
  const fmtDate = (d, opts = { month: "short", day: "numeric" }) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let state = { range: "3M", hidden: new Set(), sort: { key: "m1", dir: -1 } };
  let data, closes, dates, bench, colorOf;

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  // ---------- data ----------
  fetch("data/prices.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then(init)
    .catch(() => init(null));

  function init(json) {
    const has = json && json.series && Object.values(json.series).some((s) => Object.keys(s).length);
    if (!has) {
      $("#headline").textContent = "Small caps vs the S&P 500";
      $("#empty").hidden = false;
      return;
    }
    data = json;
    bench = json.benchmark || "SPY";
    closes = {};
    const all = new Set();
    for (const t of json.tickers) {
      const s = json.series[t.symbol] || {};
      closes[t.symbol] = new Map(Object.entries(s).map(([d, b]) => [d, b.c]));
      Object.keys(s).forEach((d) => all.add(d));
    }
    dates = [...all].sort();
    const palette = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];
    let i = 0;
    colorOf = {};
    for (const t of json.tickers) colorOf[t.symbol] = t.symbol === bench ? "--bench" : palette[i++ % palette.length];

    $("#content").hidden = false;
    $("#updated").textContent = `Data through ${fmtDate(dates[dates.length - 1], { month: "short", day: "numeric", year: "numeric" })}`;
    if (json.failures && json.failures.length)
      $("#failures").textContent = ` Last update missed: ${json.failures.map((f) => f.split(":")[0]).join(", ")}.`;

    buildRanges();
    buildLegend();
    renderAll();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 120); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderAll);
  }

  // close on or before the last date, n trading days back
  function seriesFor(sym) {
    const m = closes[sym];
    return dates.filter((d) => m.has(d)).map((d) => ({ d, c: m.get(d) }));
  }
  function ret(sym, n) {
    const s = seriesFor(sym);
    if (s.length <= n) return null;
    return s[s.length - 1].c / s[s.length - 1 - n].c - 1;
  }
  function windowDates() {
    const r = RANGES.find((x) => x.id === state.range);
    return r.days === Infinity ? dates : dates.slice(-(r.days + 1));
  }
  function rebased(sym, win) {
    const m = closes[sym];
    const pts = win.filter((d) => m.has(d)).map((d) => ({ d, c: m.get(d) }));
    if (!pts.length) return [];
    const base = pts[0].c;
    return pts.map((p) => ({ d: p.d, v: p.c / base - 1 }));
  }

  // ---------- controls ----------
  function buildRanges() {
    const box = $("#ranges");
    for (const r of RANGES) {
      const b = document.createElement("button");
      b.textContent = r.id;
      b.disabled = r.days !== Infinity && dates.length <= r.days;
      b.addEventListener("click", () => { state.range = r.id; renderAll(); });
      box.appendChild(b);
    }
    // fall back to the longest range the data supports
    const ok = RANGES.filter((r) => r.days === Infinity || dates.length > r.days);
    if (!ok.some((r) => r.id === state.range)) state.range = ok[ok.length - 2]?.id || "All";
  }
  function buildLegend() {
    const box = $("#legend");
    for (const t of data.tickers) {
      const b = document.createElement("button");
      b.setAttribute("aria-pressed", "true");
      const sw = document.createElement("span");
      sw.className = "swatch" + (t.symbol === bench ? " dash" : "");
      sw.style.background = `var(${colorOf[t.symbol]})`;
      b.append(sw, t.symbol);
      b.title = t.name;
      b.addEventListener("click", () => {
        state.hidden.has(t.symbol) ? state.hidden.delete(t.symbol) : state.hidden.add(t.symbol);
        b.setAttribute("aria-pressed", String(!state.hidden.has(t.symbol)));
        renderMain();
      });
      box.appendChild(b);
    }
  }

  function renderAll() {
    $("#ranges").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === state.range)));
    renderHeadline();
    renderMain();
    renderSpread();
    renderStyle();
    renderTable();
  }

  function periodWord() {
    return { "1M": "past month", "3M": "past three months", "6M": "past six months", "1Y": "past year", All: "full period" }[state.range];
  }

  function renderHeadline() {
    const win = windowDates();
    const iwm = rebased("IWM", win).at(-1)?.v;
    const spy = rebased(bench, win).at(-1)?.v;
    const h = $("#headline");
    h.replaceChildren();
    if (iwm == null || spy == null) { h.textContent = "Small caps vs the S&P 500"; return; }
    const gap = Math.round(iwm * 1000) / 1000 - Math.round(spy * 1000) / 1000;
    const span = (txt, c) => { const s = document.createElement("span"); s.className = c; s.textContent = txt; return s; };
    h.append(
      `Over the ${periodWord()}, small caps are `,
      span(pct(iwm), cls(iwm)),
      ` against ${pct(spy)} for the S&P 500, ${gap >= 0 ? "leading" : "trailing"} by `,
      span(pts(Math.abs(gap)).replace("+", ""), cls(gap)),
      "."
    );
  }

  // ---------- line chart ----------
  function lineChart(box, lines, { yFmt = (v) => pct(v), zero = 0, endLabels = true, tooltip = true, area = false } = {}) {
    box.replaceChildren();
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !lines.length) return;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, box);
    const all = lines.flatMap((l) => l.pts);
    const win = [...new Set(all.map((p) => p.d))].sort();
    let lo = Math.min(zero, ...all.map((p) => p.v)), hi = Math.max(zero, ...all.map((p) => p.v));
    const pad = (hi - lo) * 0.08 || 0.01; lo -= pad; hi += pad;

    // ticks
    const ticks = niceTicks(lo, hi, H < 200 ? 3 : 5);
    const meas = el("text", {}, svg);
    let left = 0;
    for (const t of ticks) { meas.textContent = yFmt(t); left = Math.max(left, meas.getComputedTextLength()); }
    let right = 0;
    if (endLabels) for (const l of lines) { meas.textContent = `${l.label} ${yFmt(l.pts.at(-1).v)}`; right = Math.max(right, meas.getComputedTextLength()); }
    meas.remove();
    const m = { t: 8, r: endLabels ? right + 10 : 4, b: 22, l: left + 8 };
    if (W - m.l - m.r < 120) { m.r = 4; endLabels = false; }
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = (d) => m.l + (win.length < 2 ? 0 : (win.indexOf(d) / (win.length - 1)) * iw);
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ih;

    for (const t of ticks) {
      el("line", { x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t), stroke: css(t === 0 ? "--muted" : "--grid"), "stroke-width": 1, "stroke-opacity": t === 0 ? 0.5 : 1 }, svg);
      const tx = el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg);
      tx.textContent = yFmt(t);
    }
    // x ticks: up to ~W/90 labels
    const nx = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    for (let i = 0; i < nx; i++) {
      const d = win[Math.round((i / (nx - 1)) * (win.length - 1))];
      const tx = el("text", { x: x(d), y: H - 4, "text-anchor": i === 0 ? "start" : i === nx - 1 ? "end" : "middle" }, svg);
      tx.textContent = fmtDate(d, win.length > 300 ? { month: "short", year: "2-digit" } : undefined);
    }

    for (const l of lines) {
      const color = css(l.color);
      const dpath = l.pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      if (area) {
        const id = "g" + Math.random().toString(36).slice(2);
        const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, el("defs", {}, svg));
        el("stop", { offset: 0, "stop-color": color, "stop-opacity": 0.22 }, g);
        el("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }, g);
        el("path", { d: `${dpath}L${x(l.pts.at(-1).d)},${y(zero)}L${x(l.pts[0].d)},${y(zero)}Z`, fill: `url(#${id})` }, svg);
      }
      el("path", {
        d: dpath, fill: "none", stroke: color, "stroke-width": l.strong ? 2.25 : 1.5,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": l.dashed ? "4 3" : "none", opacity: l.muted ? 0.55 : 1,
      }, svg);
    }

    if (endLabels) {
      // stack end labels so they never overlap
      const labs = lines.map((l) => ({ l, y: y(l.pts.at(-1).v) })).sort((a, b) => a.y - b.y);
      const gap = 13;
      for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < gap) labs[i].y = labs[i - 1].y + gap;
      const over = labs.length ? labs.at(-1).y - (m.t + ih) : 0;
      if (over > 0) for (const L of labs) L.y -= over;
      for (const L of labs) {
        const t = el("text", { x: m.l + iw + 6, y: L.y + 4, class: "end-label", fill: css(L.l.color) }, svg);
        t.style.fill = css(L.l.color);
        t.textContent = `${L.l.label} ${yFmt(L.l.pts.at(-1).v)}`;
      }
    }

    if (!tooltip) return;
    const rule = el("line", { y1: m.t, y2: m.t + ih, stroke: css("--muted"), "stroke-opacity": 0.4, visibility: "hidden" }, svg);
    const dots = lines.map((l) => el("circle", { r: 3.5, fill: css(l.color), stroke: css("--panel"), "stroke-width": 1.5, visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
    const tip = $("#tip");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(win.length - 1, Math.round(((px - m.l) / iw) * (win.length - 1))));
      const d = win[i];
      rule.setAttribute("x1", x(d)); rule.setAttribute("x2", x(d)); rule.setAttribute("visibility", "visible");
      tip.replaceChildren();
      const head = document.createElement("div"); head.className = "date"; head.textContent = fmtDate(d, { month: "short", day: "numeric", year: "numeric" });
      tip.append(head);
      const rows = lines.map((l, k) => ({ l, k, p: l.pts.find((p) => p.d === d) })).filter((r) => r.p).sort((a, b) => b.p.v - a.p.v);
      lines.forEach((_, k) => dots[k].setAttribute("visibility", "hidden"));
      for (const { l, k, p } of rows) {
        dots[k].setAttribute("cx", x(d)); dots[k].setAttribute("cy", y(p.v)); dots[k].setAttribute("visibility", "visible");
        const row = document.createElement("div"); row.className = "row";
        const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = css(l.color);
        const b = document.createElement("b"); b.textContent = l.label;
        const v = document.createElement("span"); v.textContent = yFmt(p.v); v.className = cls(p.v);
        row.append(sw, b, v); tip.append(row);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = ev.clientX + 14; if (left + tw > innerWidth - 8) left = ev.clientX - tw - 14;
      let top = ev.clientY - th / 2; top = Math.max(8, Math.min(innerHeight - th - 8, top));
      tip.style.left = left + "px"; tip.style.top = top + "px";
    };
    const leave = () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); dots.forEach((c) => c.setAttribute("visibility", "hidden")); };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  function renderMain() {
    const win = windowDates();
    const lines = data.tickers
      .filter((t) => !state.hidden.has(t.symbol))
      .map((t) => ({
        label: t.symbol,
        pts: rebased(t.symbol, win),
        color: colorOf[t.symbol],
        dashed: t.symbol === bench,
        strong: t.symbol === "IWM" || t.symbol === bench,
        muted: t.symbol !== "IWM" && t.symbol !== bench,
      }))
      .filter((l) => l.pts.length > 1);
    // draw muted lines first so IWM and SPY sit on top
    lines.sort((a, b) => Number(a.strong) - Number(b.strong));
    lineChart($("#main-chart"), lines);
  }

  function diffSeries(a, b, win) {
    const A = new Map(rebased(a, win).map((p) => [p.d, p.v]));
    return rebased(b, win).filter((p) => A.has(p.d)).map((p) => ({ d: p.d, v: A.get(p.d) - p.v }));
  }

  function renderSpread() {
    const win = windowDates();
    const s = diffSeries("IWM", bench, win);
    const v = s.at(-1)?.v;
    const big = $("#spread-value");
    big.className = "big " + cls(v);
    big.textContent = pts(v);
    const sm = document.createElement("small"); sm.textContent = periodWord(); big.append(sm);
    lineChart($("#spread-chart"), s.length > 1 ? [{ label: "Spread", pts: s, color: v >= 0 ? "--up" : "--down", strong: true }] : [],
      { yFmt: (x) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}`, endLabels: false, area: true });
  }

  function renderStyle() {
    const win = windowDates();
    const lines = ["IWN", "IWO"].filter((s) => closes[s]).map((s, i) => ({
      label: s === "IWN" ? "Value" : "Growth", pts: rebased(s, win), color: i ? "--s4" : "--s3", strong: true,
    })).filter((l) => l.pts.length > 1);
    const big = $("#style-value");
    if (lines.length === 2) {
      const gap = lines[0].pts.at(-1).v - lines[1].pts.at(-1).v;
      big.className = "big";
      big.textContent = `${gap >= 0 ? "Value" : "Growth"} by ${Math.abs(gap * 100).toFixed(1)} pts`;
    } else big.textContent = "—";
    lineChart($("#style-chart"), lines, { endLabels: true });
  }

  // ---------- table ----------
  function renderTable() {
    const table = $("#table");
    const head = table.tHead;
    head.replaceChildren();
    const tr = document.createElement("tr");
    const cols = [
      { key: "sym", label: "Ticker" },
      { key: "name", label: "Name", cls: "hide-sm" },
      { key: "price", label: "Price" },
      ...COLS,
      { key: "spark", label: "Trend", cls: "hide-sm", nosort: true },
    ];
    for (const c of cols) {
      const th = document.createElement("th");
      if (c.cls) th.className = c.cls;
      if (c.nosort) th.textContent = c.label;
      else {
        const b = document.createElement("button"); b.textContent = c.label;
        b.addEventListener("click", () => {
          state.sort = { key: c.key, dir: state.sort.key === c.key ? -state.sort.dir : (c.key === "sym" || c.key === "name" ? 1 : -1) };
          renderTable();
        });
        th.append(b);
        if (state.sort.key === c.key) th.setAttribute("aria-sort", state.sort.dir > 0 ? "ascending" : "descending");
      }
      tr.append(th);
    }
    head.append(tr);

    const rows = data.tickers.map((t) => {
      const s = seriesFor(t.symbol);
      const r = { t, sym: t.symbol, name: t.name, price: s.at(-1)?.c ?? null, s };
      for (const c of COLS) r[c.key] = ret(t.symbol, c.days);
      return r;
    });
    const { key, dir } = state.sort;
    rows.sort((a, b) => {
      const A = a[key], B = b[key];
      if (A == null) return 1; if (B == null) return -1;
      return (typeof A === "string" ? A.localeCompare(B) : A - B) * dir;
    });

    const body = table.tBodies[0];
    body.replaceChildren();
    for (const r of rows) {
      const tr = document.createElement("tr");
      const td = (txt, c) => { const d = document.createElement("td"); if (c) d.className = c; if (txt != null) d.textContent = txt; tr.append(d); return d; };
      const s = td(r.sym, "sym");
      if (r.t.group === "Benchmark" || r.sym === bench) { const g = document.createElement("span"); g.className = "group"; g.textContent = "bench"; s.append(g); }
      td(r.name, "name hide-sm");
      td(r.price == null ? "—" : money(r.price));
      for (const c of COLS) td(pct(r[c.key]), cls(r[c.key]));
      const sp = td(null, "spark hide-sm");
      sparkline(sp, r.s.slice(-63).map((p) => p.c));
      body.append(tr);
    }
  }

  function sparkline(box, vals) {
    if (vals.length < 2) return;
    const W = 100, H = 24;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, box);
    const d = vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * (W - 4) + 2).toFixed(1)},${(2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("");
    el("path", { d, fill: "none", stroke: css(vals.at(-1) >= vals[0] ? "--up" : "--down"), "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  }
})();
