/* SSSB·KÖDAGAR — dashboard. Vanilla JS, ingen byggkedja. */

"use strict";

const STORAGE_KEY = "sssb-kodagar-filter";

const state = {
  status: "alla",          // alla | stangd | aktiv
  typer: [],               // tom = alla
  omraden: [],             // tom = alla
  ytaMin: null, ytaMax: null,
  hyraMin: null, hyraMax: null,
  dagar: null,             // användarens ködagar (planeraren)
  visaAllaSegment: false,
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

function dayTint(d, alpha = 0.16) {
  const n = parseInt(dayColor(d).slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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

function passesFysisk(r) {
  if (state.typer.length && !state.typer.includes(r.typGrupp)) return false;
  if (state.ytaMin != null && (r.yta == null || r.yta < state.ytaMin)) return false;
  if (state.ytaMax != null && (r.yta == null || r.yta > state.ytaMax)) return false;
  if (state.hyraMin != null && (r.hyraNum == null || r.hyraNum < state.hyraMin)) return false;
  if (state.hyraMax != null && (r.hyraNum == null || r.hyraNum > state.hyraMax)) return false;
  return true;
}

function passesNonArea(r) {
  if (state.status !== "alla" && r.status !== state.status) return false;
  return passesFysisk(r);
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
  renderPlanera();
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

/* ————— planeraren: segment × månad ————— */

const SEGMENT_LIMIT = 14;

function closedForStats() {
  // Statusfiltret gäller inte här — segmentstatistiken bygger per definition på avgjorda.
  return rows.filter((r) =>
    r.status === "stangd" && r.kodagar != null && r.deadline &&
    passesFysisk(r) && (!state.omraden.length || state.omraden.includes(r.omrade)));
}

function segmentStats(closed) {
  const byKey = new Map();
  for (const r of closed) {
    const key = `${r.omrade}|${r.typ}|${r.yta}`;
    let s = byKey.get(key);
    if (!s) byKey.set(key, s = {
      omrade: r.omrade, typ: r.typ, yta: r.yta,
      all: [], hyror: [], perMonth: new Map(),
    });
    s.all.push(r.kodagar);
    if (r.hyraNum != null) s.hyror.push(r.hyraNum);
    const m = r.deadline.slice(0, 7);
    if (!s.perMonth.has(m)) s.perMonth.set(m, []);
    s.perMonth.get(m).push(r.kodagar);
  }
  return [...byKey.values()];
}

function monthThresholds(seg) {
  // Tröskel per kalendermånad: månadens median (över alla år) om ≥3 obs, annars helhetsmedianen.
  const overall = median(seg.all);
  const byCal = Array.from({ length: 12 }, () => []);
  for (const [m, list] of seg.perMonth) byCal[+m.slice(5, 7) - 1].push(...list);
  return {
    overall,
    perCal: byCal.map((obs) => (obs.length >= 3 ? median(obs) : overall)),
    min: Math.min(...seg.all),
  };
}

function attainable(dagar, th, calByAdd) {
  // Första dag framåt då dagar + väntetid ≥ tröskeln för den dagens kalendermånad.
  for (let add = 0; add < calByAdd.length; add++) {
    if (dagar + add >= th.perCal[calByAdd[add]]) return { add, datum: dateAdd(add) };
  }
  return { add: th.overall - dagar, datum: null };
}

function dateAdd(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function fmtYm(ym) {
  const [y, m] = ym.split("-");
  return `${MONTHS[+m - 1]} ’${y.slice(2)}`;
}

function fmtDatumKort(d) {
  return `${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`;
}

function fmtUtbud(perManad) {
  const v = perManad >= 10 ? Math.round(perManad) : Math.round(perManad * 10) / 10;
  return `${v.toLocaleString("sv-SE")}/mån`;
}

function monthCells(perMonth, months) {
  return months.map((m) => {
    const list = perMonth.get(m);
    if (!list) return '<td class="num mcell mcell-empty">·</td>';
    const v = [...list].sort((a, b) => a - b);
    const md = median(v);
    return `<td class="num mcell" style="background:${dayTint(md)}"
      title="${fmtYm(m)} · ${v.length} avgjorda · min ${v[0]} · median ${md} · max ${v[v.length - 1]}">${md}<small>${v.length}</small></td>`;
  }).join("");
}

function fordigCell(s) {
  const D = state.dagar;
  if (D == null) return '<td class="num fordig-sticky mcell-empty">–</td>';
  const { add, datum } = s.plan;
  const chansAdd = Math.max(0, s.th.min - D);
  let main, cls = "";
  if (add <= 0) { main = "Nu"; cls = " fordig-nu"; }
  else if (!datum) main = `om ~${Math.max(1, Math.round(add / 365))} år`;
  else main = fmtDatumKort(datum);
  const sub = add > 0 && chansAdd < add
    ? `<small>chans ${chansAdd <= 0 ? "nu" : fmtDatumKort(dateAdd(chansAdd))}</small>` : "";
  const title = `Typisk tröskel ${s.th.overall} ködagar, lägsta observerade ${s.th.min}. ` +
    (add <= 0 ? `Dina ${D} dagar räcker redan.` : `Dina ${D} dagar når tröskeln om ${add} dagar.`);
  return `<td class="num fordig-sticky${cls}" title="${escapeHtml(title)}"><b>${main}</b>${sub}</td>`;
}

function renderPlanera() {
  const wrap = $("#segment-matrix-wrap");
  const closed = closedForStats();
  if (!closed.length) {
    wrap.innerHTML = '<p class="planera-empty">Inga avgjorda annonser matchar filtren än — vyn fylls på i takt med att bokningsdeadlines passerar.</p>';
    return;
  }
  const months = [...new Set(closed.map((r) => r.deadline.slice(0, 7)))].sort();
  const segs = segmentStats(closed);

  const calByAdd = [];
  { const d = new Date(); for (let i = 0; i <= 1200; i++) { calByAdd.push(d.getMonth()); d.setDate(d.getDate() + 1); } }
  for (const s of segs) {
    s.n = s.all.length;
    s.th = monthThresholds(s);
    s.plan = state.dagar != null ? attainable(state.dagar, s.th, calByAdd) : null;
  }
  // Robusta segment (≥5 obs) före tunna, så att brusiga en-annons-segment inte tar toppen.
  const tunnhet = (s) => (s.n < 5 ? 1 : 0);
  segs.sort((a, b) => tunnhet(a) - tunnhet(b) ||
    (state.dagar != null ? (a.plan.add - b.plan.add || b.n - a.n) : b.n - a.n));
  const shown = state.visaAllaSegment ? segs : segs.slice(0, SEGMENT_LIMIT);

  const head = `<tr>
    <th class="seg-name seg-sticky">Segment</th>
    <th class="num">Hyra</th>
    <th class="num" title="Avgjorda annonser per månad, snitt över insamlingsperioden">Utbud</th>
    ${months.map((m) => `<th class="num">${fmtYm(m)}</th>`).join("")}
    <th class="num fordig-sticky">För dig</th></tr>`;

  const body = shown.map((s) => {
    const hyra = median(s.hyror);
    const tunn = s.n < 5;
    return `<tr${tunn ? ' class="seg-tunn" title="Få observationer — osäker statistik"' : ""}>
      <td class="seg-name seg-sticky"><b>${escapeHtml(s.omrade)}</b>
        <span class="seg-typ">${escapeHtml(s.typ)} · ${s.yta} m²${tunn ? " · få obs" : ""}</span></td>
      <td class="num">${hyra != null ? hyra.toLocaleString("sv-SE") : "–"}</td>
      <td class="num">${fmtUtbud(s.n / months.length)}</td>
      ${monthCells(s.perMonth, months)}
      ${fordigCell(s)}</tr>`;
  }).join("");

  // Summarad med gamla månadsvyns blandade siffra — jämförbar bara inom sig själv.
  const mixPerMonth = new Map();
  for (const r of closed) {
    const m = r.deadline.slice(0, 7);
    if (!mixPerMonth.has(m)) mixPerMonth.set(m, []);
    mixPerMonth.get(m).push(r.kodagar);
  }
  const mixRow = `<tr class="seg-mix">
    <td class="seg-name seg-sticky"><b>Alla matchande</b><span class="seg-typ">blandade segment</span></td>
    <td class="num">–</td>
    <td class="num">${fmtUtbud(closed.length / months.length)}</td>
    ${monthCells(mixPerMonth, months)}
    <td class="num fordig-sticky mcell-empty">–</td></tr>`;

  const toggle = segs.length > SEGMENT_LIMIT
    ? `<button id="seg-toggle" class="chip">${state.visaAllaSegment ? "Visa färre" : `Visa alla ${segs.length} segment`}</button>` : "";
  const legend = `<div class="matrix-legend">Cellfärg = median ködagar:${LEGEND_STEPS.map(([label, c]) =>
    `<span class="dot" style="background:${c}"></span>${label}`).join("")}</div>`;

  wrap.innerHTML = `<table id="segment-matrix">
      <thead>${head}</thead><tbody>${body}${mixRow}</tbody></table>
    <div class="matrix-foot">${toggle}${legend}</div>`;

  const btn = $("#seg-toggle");
  if (btn) btn.addEventListener("click", () => { state.visaAllaSegment = !state.visaAllaSegment; render(); });
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

  const dagarInput = $("#mina-dagar"), startInput = $("#ko-start");
  const isoDaysAgo = (n) => {
    const t = dateAdd(-n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };
  if (state.dagar != null) {
    dagarInput.value = state.dagar;
    startInput.value = isoDaysAgo(state.dagar);
  }
  dagarInput.addEventListener("input", () => {
    const v = dagarInput.value;
    state.dagar = v === "" ? null : Math.max(0, Math.floor(+v) || 0);
    startInput.value = state.dagar == null ? "" : isoDaysAgo(state.dagar);
    render();
  });
  startInput.addEventListener("change", () => {
    if (!startInput.value) { dagarInput.value = ""; state.dagar = null; render(); return; }
    const diff = Math.round((Date.now() - new Date(startInput.value + "T00:00").getTime()) / 86400000);
    state.dagar = Math.max(0, diff);
    dagarInput.value = state.dagar;
    render();
  });

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
