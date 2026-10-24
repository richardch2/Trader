// Small dependency-free SVG charts shared by cards.
import { pct, date, longDate, tone } from "./format.js";

const SVGNS = "http://www.w3.org/2000/svg";

/** Read a CSS custom property, e.g. css("--s1"). */
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function svgEl(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/**
 * Multi-line chart over dates.
 * lines: [{label, pts: [{d: "YYYY-MM-DD", v: number}], color: "--s1", dashed?, strong?, muted?}]
 * options: yFmt, zero (baseline; null to fit the data, e.g. for prices), endLabels, tooltip, area
 */
export function lineChart(box, lines, { yFmt = (v) => pct(v), zero = 0, endLabels = true, tooltip = true, area = false } = {}) {
  box.replaceChildren();
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !lines.length) return;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, box);
  const all = lines.flatMap((l) => l.pts);
  const win = [...new Set(all.map((p) => p.d))].sort();
  const idx = new Map(win.map((d, i) => [d, i]));
  const vals = all.map((p) => p.v);
  let lo = Math.min(...vals, ...(zero == null ? [] : [zero])), hi = Math.max(...vals, ...(zero == null ? [] : [zero]));
  const pad = (hi - lo) * 0.08 || 0.01; lo -= pad; hi += pad;

  const ticks = niceTicks(lo, hi, H < 200 ? 3 : 5);
  const meas = svgEl("text", {}, svg);
  let left = 0, right = 0;
  for (const t of ticks) { meas.textContent = yFmt(t); left = Math.max(left, meas.getComputedTextLength()); }
  if (endLabels) for (const l of lines) { meas.textContent = `${l.label} ${yFmt(l.pts.at(-1).v)}`; right = Math.max(right, meas.getComputedTextLength()); }
  meas.remove();
  const m = { t: 8, r: endLabels ? right + 10 : 4, b: 22, l: left + 8 };
  if (W - m.l - m.r < 120) { m.r = 4; endLabels = false; }
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = (d) => m.l + (win.length < 2 ? 0 : (idx.get(d) / (win.length - 1)) * iw);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ih;

  for (const t of ticks) {
    svgEl("line", { x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t), stroke: css(t === zero ? "--muted" : "--grid"), "stroke-width": 1, "stroke-opacity": t === zero ? 0.5 : 1 }, svg);
    svgEl("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = yFmt(t);
  }
  const nx = Math.max(2, Math.min(6, Math.floor(iw / 90)));
  for (let i = 0; i < nx; i++) {
    const d = win[Math.round((i / (nx - 1)) * (win.length - 1))];
    svgEl("text", { x: x(d), y: H - 4, "text-anchor": i === 0 ? "start" : i === nx - 1 ? "end" : "middle" }, svg)
      .textContent = date(d, win.length > 300 ? { month: "short", year: "2-digit" } : undefined);
  }

  for (const l of lines) {
    const color = css(l.color);
    const dpath = l.pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    if (area) {
      const id = "g" + Math.random().toString(36).slice(2);
      const g = svgEl("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, svgEl("defs", {}, svg));
      svgEl("stop", { offset: 0, "stop-color": color, "stop-opacity": 0.22 }, g);
      svgEl("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }, g);
      svgEl("path", { d: `${dpath}L${x(l.pts.at(-1).d)},${y(zero ?? lo)}L${x(l.pts[0].d)},${y(zero ?? lo)}Z`, fill: `url(#${id})` }, svg);
    }
    svgEl("path", {
      d: dpath, fill: "none", stroke: color, "stroke-width": l.strong ? 2.25 : 1.5,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      "stroke-dasharray": l.dashed ? "4 3" : "none", opacity: l.muted ? 0.55 : 1,
    }, svg);
  }

  if (endLabels) {
    const labs = lines.map((l) => ({ l, y: y(l.pts.at(-1).v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
    const over = labs.length ? labs.at(-1).y - (m.t + ih) : 0;
    if (over > 0) for (const L of labs) L.y -= over;
    for (const L of labs) {
      const t = svgEl("text", { x: m.l + iw + 6, y: L.y + 4, class: "end-label" }, svg);
      t.style.fill = css(L.l.color);
      t.textContent = `${L.l.label} ${yFmt(L.l.pts.at(-1).v)}`;
    }
  }

  if (tooltip) attachTooltip(svg, { lines, win, x, y, m, iw, ih, W, yFmt });
}

function attachTooltip(svg, { lines, win, x, y, m, iw, ih, W, yFmt }) {
  const tip = document.getElementById("tip");
  const rule = svgEl("line", { y1: m.t, y2: m.t + ih, stroke: css("--muted"), "stroke-opacity": 0.4, visibility: "hidden" }, svg);
  const dots = lines.map((l) => svgEl("circle", { r: 3.5, fill: css(l.color), stroke: css("--panel"), "stroke-width": 1.5, visibility: "hidden" }, svg));
  const byDate = lines.map((l) => new Map(l.pts.map((p) => [p.d, p.v])));
  const hit = svgEl("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);

  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const d = win[Math.max(0, Math.min(win.length - 1, Math.round(((px - m.l) / iw) * (win.length - 1))))];
    rule.setAttribute("x1", x(d)); rule.setAttribute("x2", x(d)); rule.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const head = document.createElement("div"); head.className = "date"; head.textContent = longDate(d);
    tip.append(head);
    const rows = lines.map((l, k) => ({ l, k, v: byDate[k].get(d) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    dots.forEach((c) => c.setAttribute("visibility", "hidden"));
    for (const { l, k, v } of rows) {
      dots[k].setAttribute("cx", x(d)); dots[k].setAttribute("cy", y(v)); dots[k].setAttribute("visibility", "visible");
      const row = document.createElement("div"); row.className = "row";
      const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = css(l.color);
      const b = document.createElement("b"); b.textContent = l.label;
      const val = document.createElement("span"); val.textContent = yFmt(v); val.className = tone(v);
      row.append(sw, b, val); tip.append(row);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = ev.clientX + 14; if (left + tw > innerWidth - 8) left = ev.clientX - tw - 14;
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, Math.min(innerHeight - th - 8, ev.clientY - th / 2)) + "px";
  };
  const leave = () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); dots.forEach((c) => c.setAttribute("visibility", "hidden")); };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
}

/** Tiny trend line, green if up over the period, red if down. */
export function sparkline(box, vals, W = 100, H = 24) {
  if (vals.length < 2) return;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, box);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * (W - 4) + 2).toFixed(1)},${(2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("");
  svgEl("path", { d, fill: "none", stroke: css(vals.at(-1) >= vals[0] ? "--up" : "--down"), "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
}
