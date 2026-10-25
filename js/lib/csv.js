// Download a table as a CSV file the viewer saves (opens in Excel, Numbers, Google Sheets).
import { h } from "../core.js";

const cell = (v) => {
  if (v == null || (typeof v === "number" && !isFinite(v))) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** rows: [[header, …], [value, …], …]. Numbers are written plainly, so spreadsheets can sum them. */
export function downloadCSV(filename, rows) {
  const text = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A small "CSV" link for a card's tool area; rows() is called on click, so it exports what's current. */
export function csvLink(name, rows) {
  const b = h("button", "link-btn tool-link", "CSV");
  b.title = "Download as a spreadsheet (CSV)";
  b.addEventListener("click", () => {
    const day = new Date().toISOString().slice(0, 10);
    downloadCSV(`${name}-${day}.csv`, rows());
  });
  return b;
}
