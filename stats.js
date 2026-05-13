/**
 * stats.js  —  Audio Detector enhanced stats dashboard
 *
 * Drop-in replacement. Assumes the same Firebase setup as the rest of the
 * project (auth + Firestore collection "detections/{uid}/events" where each
 * doc has: { label: string, confidence: number, timestamp: Firestore Timestamp })
 *
 * If your collection path or field names differ, update COLLECTION_PATH and
 * the field constants at the top of this file.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Import your shared Firebase config ──────────────────────────────────────
// This keeps the same config object used in firebase.js / app.js.
import { firebaseConfig } from "./firebase.js";

// ── Firestore field names — update if yours differ ──────────────────────────
const FIELD_LABEL      = "label";
const FIELD_CONFIDENCE = "confidence";
const FIELD_TIMESTAMP  = "timestamp";   // Firestore Timestamp field

// Path: detections/{uid}/events
const EVENTS_SUBCOLLECTION = "events";
const DETECTIONS_ROOT      = "detections";

// ── Colour palette per sound label ──────────────────────────────────────────
const SOUND_COLORS = [
  "#4f9cf9", "#f97b4f", "#4ff9b6", "#f9d44f",
  "#c97bf9", "#f94f7b", "#7bf94f", "#4fc5f9",
];

// ── Bootstrap ────────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let allDetections = [];   // raw array for the active period
let activeDays    = 7;
let chartInstances = {};  // track Chart.js instances for cleanup

// DOM refs
const loadingEl  = document.getElementById("loadingState");
const emptyEl    = document.getElementById("emptyState");
const contentEl  = document.getElementById("statsContent");
const emailEl    = document.getElementById("userEmail");

// ── Auth gate ─────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "index.html"; return; }
  emailEl.textContent = user.email;
  document.getElementById("signOutBtn").onclick = () => signOut(auth);
  loadData(user.uid, activeDays);
});

// ── Period filter buttons ────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn[data-days]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn[data-days]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeDays = parseInt(btn.dataset.days, 10);
    const uid = auth.currentUser?.uid;
    if (uid) loadData(uid, activeDays);
  });
});

// ── CSV export ───────────────────────────────────────────────────────────────
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (!allDetections.length) return;
  const header = ["timestamp", "label", "confidence"];
  const rows = allDetections.map(d => [
    new Date(d.ts).toISOString(),
    `"${d.label}"`,
    d.confidence.toFixed(4),
  ]);
  const csv = [header, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href: url, download: `detections_${activeDays}d.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData(uid, days) {
  showState("loading");
  destroyCharts();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Timestamp.fromDate(since);

  try {
    const ref = collection(db, DETECTIONS_ROOT, uid, EVENTS_SUBCOLLECTION);
    const q   = query(ref,
      where(FIELD_TIMESTAMP, ">=", sinceTs),
      orderBy(FIELD_TIMESTAMP, "asc")
    );
    const snap = await getDocs(q);

    allDetections = snap.docs.map(doc => {
      const d = doc.data();
      return {
        label:      d[FIELD_LABEL]      ?? "Unknown",
        confidence: d[FIELD_CONFIDENCE] ?? 0,
        ts:         d[FIELD_TIMESTAMP].toDate().getTime(),
      };
    });

    if (!allDetections.length) { showState("empty"); return; }

    showState("content");
    renderDashboard(allDetections, days);
  } catch (err) {
    console.error("Failed to load detections:", err);
    showState("empty");
  }
}

// ── Master render ─────────────────────────────────────────────────────────────
function renderDashboard(data, days) {
  const labels     = uniqueLabels(data);
  const colorMap   = buildColorMap(labels);

  renderKPIs(data, days);
  renderTimeline(data, labels, colorMap, days);
  renderDonut(data, labels, colorMap);
  renderScatter(data, labels, colorMap);
  renderHeatmap(data);
  renderTable(data, labels, colorMap);
}

// ── KPI strip ─────────────────────────────────────────────────────────────────
function renderKPIs(data, days) {
  const total  = data.length;
  const avgConf = (data.reduce((s, d) => s + d.confidence, 0) / total * 100).toFixed(1);

  // busiest hour
  const hourCounts = Array(24).fill(0);
  data.forEach(d => hourCounts[new Date(d.ts).getHours()]++);
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

  // most frequent label
  const labelCounts = {};
  data.forEach(d => labelCounts[d.label] = (labelCounts[d.label] ?? 0) + 1);
  const topLabel = Object.entries(labelCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "—";

  const strip = document.getElementById("kpiStrip");
  strip.innerHTML = "";
  const kpis = [
    { value: total,          label: `Detections (${days}d)`,   accent: "#4f9cf9" },
    { value: avgConf + "%",  label: "Avg confidence",          accent: "#4ff9b6" },
    { value: fmtHour(peakHour), label: "Peak hour",            accent: "#f9d44f" },
    { value: topLabel,       label: "Top sound",               accent: "#f97b4f" },
  ];
  kpis.forEach(k => {
    const el = document.createElement("div");
    el.className = "kpi";
    el.style.setProperty("--accent-color", k.accent);
    el.innerHTML = `<div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div>`;
    strip.appendChild(el);
  });
}

// ── Timeline chart ────────────────────────────────────────────────────────────
function renderTimeline(data, labels, colorMap, days) {
  // Bucket by day
  const buckets = {};
  data.forEach(d => {
    const day = dayKey(d.ts);
    if (!buckets[day]) buckets[day] = {};
    buckets[day][d.label] = (buckets[day][d.label] ?? 0) + 1;
  });

  const dayKeys = sortedKeys(buckets);
  const datasets = labels.map(lbl => ({
    label: lbl,
    data:  dayKeys.map(k => buckets[k]?.[lbl] ?? 0),
    backgroundColor: hex2rgba(colorMap[lbl], 0.7),
    borderColor:     colorMap[lbl],
    borderWidth: 1,
    borderRadius: 3,
  }));

  chartInstances.timeline = new Chart(
    document.getElementById("timelineChart"),
    {
      type: "bar",
      data: { labels: dayKeys, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#6b7280", font: { family: "DM Mono", size: 11 }, boxWidth: 10 } } },
        scales: {
          x: { stacked: true, ticks: { color: "#6b7280", font: { family: "DM Mono", size: 10 } }, grid: { color: "#252933" } },
          y: { stacked: true, ticks: { color: "#6b7280", font: { family: "DM Mono", size: 10 }, stepSize: 1 }, grid: { color: "#252933" } },
        }
      }
    }
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────
function renderDonut(data, labels, colorMap) {
  const counts = {};
  data.forEach(d => counts[d.label] = (counts[d.label] ?? 0) + 1);

  chartInstances.donut = new Chart(
    document.getElementById("donutChart"),
    {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: labels.map(l => counts[l] ?? 0), backgroundColor: labels.map(l => colorMap[l]), borderWidth: 0, hoverOffset: 8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: { position: "right", labels: { color: "#6b7280", font: { family: "DM Mono", size: 11 }, boxWidth: 10, padding: 14 } }
        }
      }
    }
  );
}

// ── Scatter chart ─────────────────────────────────────────────────────────────
function renderScatter(data, labels, colorMap) {
  const datasets = labels.map(lbl => ({
    label: lbl,
    data: data.filter(d => d.label === lbl).map(d => ({ x: d.ts, y: +(d.confidence * 100).toFixed(1) })),
    backgroundColor: hex2rgba(colorMap[lbl], 0.6),
    pointRadius: 4,
    pointHoverRadius: 6,
  }));

  chartInstances.scatter = new Chart(
    document.getElementById("scatterChart"),
    {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#6b7280", font: { family: "DM Mono", size: 11 }, boxWidth: 10 } } },
        scales: {
          x: {
            type: "time",
            time: { tooltipFormat: "MMM d, h:mm a" },
            ticks: { color: "#6b7280", font: { family: "DM Mono", size: 10 } },
            grid: { color: "#252933" }
          },
          y: {
            min: 0, max: 100,
            title: { display: true, text: "Confidence %", color: "#6b7280", font: { family: "DM Mono", size: 10 } },
            ticks: { color: "#6b7280", font: { family: "DM Mono", size: 10 }, callback: v => v + "%" },
            grid: { color: "#252933" }
          }
        }
      }
    }
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function renderHeatmap(data) {
  const DAYS  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  // count[dow][hour]
  const count = Array.from({ length: 7 }, () => Array(24).fill(0));
  data.forEach(d => {
    const dt = new Date(d.ts);
    count[dt.getDay()][dt.getHours()]++;
  });
  const maxVal = Math.max(1, ...count.flat());

  const container = document.getElementById("heatmapContainer");
  container.innerHTML = "";

  // Hour labels row
  const labelRow = document.createElement("div");
  labelRow.className = "heatmap-hour-labels";
  labelRow.innerHTML = `<div></div>` + HOURS.map(h =>
    `<div class="heatmap-hour-label">${h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h-12) + "p"}</div>`
  ).join("");
  container.appendChild(labelRow);

  // Grid rows
  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  DAYS.forEach((day, dow) => {
    const dayLabel = document.createElement("div");
    dayLabel.className = "heatmap-day-label";
    dayLabel.textContent = day;
    grid.appendChild(dayLabel);

    HOURS.forEach(h => {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const val = count[dow][h];
      const intensity = val / maxVal;
      // Interpolate from surface colour → accent
      cell.style.background = val > 0
        ? `rgba(79, 156, 249, ${0.12 + intensity * 0.88})`
        : "var(--stats-border)";
      cell.title = `${day} ${fmtHour(h)}: ${val} detection${val !== 1 ? "s" : ""}`;
      cell.dataset.tip = `${day} ${fmtHour(h)}: ${val}`;
      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

// ── Summary table ─────────────────────────────────────────────────────────────
function renderTable(data, labels, colorMap) {
  const tbody = document.getElementById("summaryTableBody");
  tbody.innerHTML = "";

  labels.forEach(lbl => {
    const rows = data.filter(d => d.label === lbl);
    if (!rows.length) return;

    const count   = rows.length;
    const avgConf = rows.reduce((s, d) => s + d.confidence, 0) / count;
    const lastTs  = Math.max(...rows.map(d => d.ts));

    // peak hour
    const hc = Array(24).fill(0);
    rows.forEach(d => hc[new Date(d.ts).getHours()]++);
    const peakH = hc.indexOf(Math.max(...hc));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="sound-pill">
          <span class="sound-dot" style="background:${colorMap[lbl]}"></span>
          ${lbl}
        </div>
      </td>
      <td>${count}</td>
      <td>
        <div class="conf-bar-wrap">
          <div class="conf-bar"><div class="conf-bar-fill" style="width:${(avgConf*100).toFixed(0)}%;background:${colorMap[lbl]}"></div></div>
          <span>${(avgConf*100).toFixed(1)}%</span>
        </div>
      </td>
      <td>${fmtHour(peakH)}</td>
      <td>${fmtRelTime(lastTs)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showState(state) {
  loadingEl.hidden  = state !== "loading";
  emptyEl.hidden    = state !== "empty";
  contentEl.hidden  = state !== "content";
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = {};
}

function uniqueLabels(data) {
  return [...new Set(data.map(d => d.label))];
}

function buildColorMap(labels) {
  const map = {};
  labels.forEach((lbl, i) => map[lbl] = SOUND_COLORS[i % SOUND_COLORS.length]);
  return map;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function hex2rgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmtHour(h) {
  if (h === 0)  return "12 AM";
  if (h < 12)   return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function fmtRelTime(ts) {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
