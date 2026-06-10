/* SSSB·KÖDAGAR — dashboard. Vanilla JS, ingen byggkedja. */

"use strict";

const STORAGE_KEY = "sssb-kodagar-filter";

const state = {
  status: "alla",          // alla | stangd | aktiv
  typer: [],               // tom = alla
  omraden: [],             // tom = alla
  ytaMin: null, ytaMax: null,
  hyraMin: null, hyraMax: null,
  sort: { key: "kodagar", dir: "desc" },
};

let rows = [];
let map, markerLayer;

/* ————— hjälpare ————— */

const $ = (sel) => document.querySelector(sel);

function parseHyra(s) {
  const digits = String(s || "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function dayColor(d) {
  if (d == null) return "#9a958b";
  if (d < 90) return "#1f6f54";
  if (d < 180) return "#7a8c2e";
  if (d < 365) return "#c98a1b";
  if (d < 730) return "#c45a1f";
  return "#b5371f";
}

const LEGEND_STEPS = [
  ["< 90", "#1f6f54"], ["90–179", "#7a8c2e"], ["180–364", "#c98a1b"],
  ["365–729", "#c45a1f"], ["≥ 730", "#b5371f"],
];

const MONTHS = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

function fmtDeadline(iso) {
  if (!iso) return "–";
  const [date, time] = iso.split("T");
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${time}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function saveState() {
  const { sort, ...rest } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
}

function loadState() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch { /* korrupt lagring ignoreras */ }
}

/* ————— filtrering ————— */

function passesNonArea(r) {
  if (state.status !== "alla" && r.status !== state.status) return false;
  if (state.typer.length && !state.typer.includes(r.typGrupp)) return false;
  if (state.ytaMin != null && (r.yta == null || r.yta < state.ytaMin)) return false;
  if (state.ytaMax != null && (r.yta == null || r.yta > state.ytaMax)) return false;
  if (state.hyraMin != null && (r.hyraNum == null || r.hyraNum < state.hyraMin)) return false;
  if (state.hyraMax != null && (r.hyraNum == null || r.hyraNum > state.hyraMax)) return false;
  return true;
}

function passesAll(r) {
  return passesNonArea(r) && (!state.omraden.length || state.omraden.includes(r.omrade));
}

/* ————— rendering ————— */

function render() {
  const visible = rows.filter(passesAll);
  sortRows(visible);
  renderTable(visible);
  renderSummary();
  renderSeason();
  renderMap();
  renderHeadline();
  renderControls();
  saveState();
}

function sortRows(arr) {
  const { key, dir } = state.sort;
  const sgn = dir === "asc" ? 1 : -1;
  arr.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;       // null sist oavsett riktning
    if (vb == null) return -1;
    if (typeof va === "number") return sgn * (va - vb);
    return sgn * String(va).localeCompare(String(vb), "sv");
  });
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.toggle("sorted-asc", th.dataset.sort === key && dir === "asc");
    th.classList.toggle("sorted-desc", th.dataset.sort === key && dir === "desc");
  });
}

function kodagarCell(r) {
  if (r.kodagar == null) return '<span class="status-stangd-ej-bokad">–</span>';
  if (r.status === "aktiv") {
    return `<span class="kodagar-live">${r.kodagar}</span><span class="live-dot" title="Pågående — nuvarande ledare"></span>`;
  }
  return `<span class="kodagar-final">${r.kodagar}</span>`;
}

function renderTable(visible) {
  const tbody = $("#listing-tbody");
  $("#row-count").textContent = `${visible.length} av ${rows.length}`;
  if (!visible.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Inga annonser matchar filtren.</td></tr>';
    return;
  }
  tbody.innerHTML = visible.map((r, i) => `
    <tr class="row" data-i="${i}" data-key="${escapeHtml(r.key)}">
      <td>${escapeHtml(r.adress)}</td>
      <td>${escapeHtml(r.omrade)}</td>
      <td>${escapeHtml(r.typGrupp)}</td>
      <td class="num">${r.yta ?? "–"}</td>
      <td>${escapeHtml(r.vaning ?? "–")}</td>
      <td class="num">${r.hyraNum != null ? r.hyraNum.toLocaleString("sv-SE") : "–"}</td>
      <td class="num">${kodagarCell(r)}</td>
      <td class="num">${r.antalSokande ?? "–"}</td>
      <td>${fmtDeadline(r.deadline)}</td>
    </tr>`).join("");

  tbody.querySelectorAll("tr.row").forEach((tr) => {
    tr.addEventListener("click", () => toggleExpand(tr, visible[+tr.dataset.i]));
  });
}

function toggleExpand(tr, r) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("expand")) { next.remove(); return; }
  document.querySelectorAll("tr.expand").forEach((e) => e.remove());

  const bilder = (r.bilder || []).map((b) =>
    `<a href="${escapeHtml(b.fil)}" target="_blank" rel="noopener">
       <img src="${escapeHtml(b.fil)}" alt="${escapeHtml(b.text || "Bild")}" loading="lazy"></a>`).join("");

  const links = [
    r.detaljUrl && `<a href="${escapeHtml(r.detaljUrl)}" target="_blank" rel="noopener">Originalannons hos SSSB ↗</a>`,
    r.planlosning && `<a href="${escapeHtml(r.planlosning)}" target="_blank" rel="noopener">Planlösning (PDF, sparad kopia)</a>`,
  ].filter(Boolean).join("");

  const meta = [
    `Publicerad ${r.publiceratDatum ?? "?"}`,
    `Objekt ${r.objektNr}`,
    r.bokadStatus,
  ].filter(Boolean).join(" · ");

  const expand = document.createElement("tr");
  expand.className = "expand";
  expand.innerHTML = `<td colspan="9">
    <div class="expand-inner">
      <div class="expand-links">${links || "<em>Inga länkar</em>"}<div class="expand-meta">${escapeHtml(meta)}</div></div>
      <div class="expand-bilder">${bilder}</div>
    </div></td>`;
  tr.after(expand);
}

function areaStats() {
  // Kartan & summeringen speglar typ/yta/hyra-filtren men inte områdesvalet,
  // så att övriga områden förblir klickbara för jämförelse.
  const byArea = new Map();
  for (const r of rows) {
    if (!passesNonArea(r)) continue;
    if (!byArea.has(r.omrade)) byArea.set(r.omrade, []);
    byArea.get(r.omrade).push(r);
  }
  let usedFallback = false;
  const stats = [...byArea.entries()].map(([omrade, list]) => {
    let basis = list.filter((r) => r.status === "stangd" && r.kodagar != null);
    if (!basis.length) {
      basis = list.filter((r) => r.kodagar != null);
      if (basis.length) usedFallback = true;
    }
    const lats = list.filter((r) => r.lat != null);
    return {
      omrade,
      antal: list.length,
      median: median(basis.map((r) => r.kodagar)),
      lat: lats.length ? lats.reduce((s, r) => s + r.lat, 0) / lats.length : null,
      lon: lats.length ? lats.reduce((s, r) => s + r.lon, 0) / lats.length : null,
    };
  });
  return { stats, usedFallback };
}

function toggleArea(omrade) {
  const i = state.omraden.indexOf(omrade);
  if (i >= 0) state.omraden.splice(i, 1);
  else state.omraden.push(omrade);
  render();
}

function renderSummary() {
  const { stats, usedFallback } = areaStats();
  stats.sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity));
  $("#summary-fallback-note").textContent =
    usedFallback ? " (kursivt: pågående, inget avgjort än)" : "";
  $("#omrade-summary-list").innerHTML = stats.map((s) => {
    const dimmed = state.omraden.length && !state.omraden.includes(s.omrade);
    const italic = usedFallback ? "font-style:italic" : "";
    return `<li data-omrade="${escapeHtml(s.omrade)}" class="${dimmed ? "dimmed" : ""}" title="Klicka för att filtrera">
      <span class="o-name">${escapeHtml(s.omrade)}</span>
      <span class="o-days" style="color:${dayColor(s.median)};${italic}">${s.median ?? "–"}</span>
      <span class="o-n">${s.antal} st</span>
    </li>`;
  }).join("");
  document.querySelectorAll("#omrade-summary-list li").forEach((li) => {
    li.addEventListener("click", () => toggleArea(li.dataset.omrade));
  });
}

function renderMap() {
  if (!map) return;
  markerLayer.clearLayers();
  const { stats } = areaStats();
  for (const s of stats) {
    if (s.lat == null) continue;
    const selected = !state.omraden.length || state.omraden.includes(s.omrade);
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: Math.max(8, Math.min(20, 6 + Math.sqrt(s.antal) * 2.5)),
      color: "#1c1914",
      weight: selected ? 2 : 1,
      fillColor: dayColor(s.median),
      fillOpacity: selected ? 0.85 : 0.25,
    });
    marker.bindTooltip(
      `<strong>${escapeHtml(s.omrade)}</strong><br>` +
      `${s.median != null ? s.median + " ködagar (median)" : "ingen ködata än"}<br>` +
      `${s.antal} annonser`,
      { direction: "top" });
    marker.on("click", () => toggleArea(s.omrade));
    markerLayer.addLayer(marker);
  }
}

function renderSeason() {
  const closed = rows.filter((r) =>
    passesAll(r) && r.status === "stangd" && r.kodagar != null && r.deadline);
  const el = $("#season-chart");
  if (!closed.length) {
    el.innerHTML = '<p class="season-empty">Inga avgjorda annonser matchar filtren än — vyn fylls på i takt med att bokningsdeadlines passerar.</p>';
    return;
  }
  const byMonth = new Map();
  for (const r of closed) {
    const m = r.deadline.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r.kodagar);
  }
  const months = [...byMonth.entries()]
    .map(([m, list]) => ({ m, median: median(list), antal: list.length }))
    .sort((a, b) => a.m.localeCompare(b.m));
  const maxMedian = Math.max(...months.map((s) => s.median), 1);
  el.innerHTML = months.map((s) => {
    const [y, mm] = s.m.split("-");
    const label = `${MONTHS[+mm - 1]} ${y}`;
    return `<div class="season-row">
      <span class="season-label">${label}</span>
      <span class="season-bar-track">
        <span class="season-bar" style="width:${(s.median / maxMedian) * 100}%;background:${dayColor(s.median)}"></span>
      </span>
      <span class="season-value">${s.median}</span>
      <span class="season-n">${s.antal} st</span>
    </div>`;
  }).join("");
}

function renderHeadline() {
  const stangda = rows.filter((r) => r.status === "stangd" && r.kodagar != null);
  const aktiva = rows.filter((r) => r.status === "aktiv");
  const med = median(stangda.map((r) => r.kodagar));
  $("#headline-stats").innerHTML = `
    <div class="stat"><b>${rows.length}</b><span>annonser följda</span></div>
    <div class="stat"><b>${stangda.length}</b><span>avgjorda</span></div>
    <div class="stat"><b>${med ?? "–"}</b><span>median ködagar</span></div>
    <div class="stat"><b>${aktiva.length}</b><span>pågående</span></div>`;
}

function renderControls() {
  document.querySelectorAll("#status-group .chip").forEach((c) =>
    c.classList.toggle("on", c.dataset.status === state.status));
  document.querySelectorAll("#typ-group .chip").forEach((c) =>
    c.classList.toggle("on", state.typer.includes(c.dataset.typ)));
  document.querySelectorAll("#omrade-checkboxes input").forEach((cb) =>
    cb.checked = !state.omraden.length || state.omraden.includes(cb.value));
  $("#omrade-summary").textContent = state.omraden.length
    ? `Områden: ${state.omraden.length} valda`
    : "Områden: alla";
}

/* ————— uppstart ————— */

function buildControls() {
  const typer = [...new Set(rows.map((r) => r.typGrupp))].sort((a, b) => a.localeCompare(b, "sv"));
  $("#typ-group").innerHTML = typer.map((t) =>
    `<button class="chip falu" data-typ="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
  document.querySelectorAll("#typ-group .chip").forEach((c) =>
    c.addEventListener("click", () => {
      const i = state.typer.indexOf(c.dataset.typ);
      if (i >= 0) state.typer.splice(i, 1); else state.typer.push(c.dataset.typ);
      render();
    }));

  document.querySelectorAll("#status-group .chip").forEach((c) =>
    c.addEventListener("click", () => { state.status = c.dataset.status; render(); }));

  const omraden = [...new Set(rows.map((r) => r.omrade))].sort((a, b) => a.localeCompare(b, "sv"));
  $("#omrade-checkboxes").innerHTML = omraden.map((o) =>
    `<label><input type="checkbox" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join("");
  document.querySelectorAll("#omrade-checkboxes input").forEach((cb) =>
    cb.addEventListener("change", () => {
      const checked = [...document.querySelectorAll("#omrade-checkboxes input:checked")].map((c) => c.value);
      state.omraden = checked.length === omraden.length ? [] : checked;
      render();
    }));
  $("#omrade-alla").addEventListener("click", () => { state.omraden = []; render(); });
  // Tom lista betyder "alla", så "rensa allt" representeras med en omöjlig post.
  $("#omrade-inga").addEventListener("click", () => { state.omraden = ["__inget__"]; render(); });

  const bindRange = (id, key) => {
    $(id).value = state[key] ?? "";
    $(id).addEventListener("input", () => {
      const v = $(id).value;
      state[key] = v === "" ? null : +v;
      render();
    });
  };
  bindRange("#yta-min", "ytaMin"); bindRange("#yta-max", "ytaMax");
  bindRange("#hyra-min", "hyraMin"); bindRange("#hyra-max", "hyraMax");

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key, dir: key === "kodagar" ? "desc" : "asc" };
      render();
    }));
}

function buildMap() {
  map = L.map("map", { scrollWheelZoom: false }).setView([59.36, 18.05], 11);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '© OpenStreetMap, © CARTO',
    maxZoom: 18,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  $("#map-legend").innerHTML =
    '<strong>Median ködagar</strong><br>' +
    LEGEND_STEPS.map(([label, color]) =>
      `<span class="dot" style="background:${color}"></span>${label}<br>`).join("");
}

async function init() {
  loadState();
  const res = await fetch("data.json", { cache: "no-store" });
  const data = await res.json();
  rows = data.listings.map((r) => ({
    ...r,
    hyraNum: parseHyra(r.hyra),
    typGrupp: r.typOvergripande || r.typ || "Övrigt",
  }));
  $("#generated-at").textContent = `Uppdaterad ${String(data.genererad).replace("T", " ").slice(0, 16)}`;
  buildMap();
  buildControls();
  render();
}

init().catch((e) => {
  $("#listing-tbody").innerHTML =
    `<tr class="empty-row"><td colspan="9">Kunde inte ladda data.json: ${escapeHtml(e.message)}</td></tr>`;
});
