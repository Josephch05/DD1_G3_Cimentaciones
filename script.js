// =========================================================================
// SIMULACIÓN DE LICUEFACCIÓN — Grupo 03 — 1ACI0707 Ingeniería de Cimentaciones
// Método: Seed-Idriss simplificado (Youd et al. 2001 / Boulanger & Idriss 2004)
// =========================================================================

const PA = 101.3; // presión atmosférica de referencia, kPa

let strataIdCounter = 0;
let strata = [];       // {id, top, bottom, soil, nspt, fc, gNat, gSat}
let lastResults = null; // resultados calculados por estrato

// -------------------------------------------------------------------------
// SOIL TYPE DEFAULTS (unit weights typical ranges, kN/m3)
// -------------------------------------------------------------------------
const SOIL_TYPES = ["SP", "SM", "SP-SM", "SC", "ML", "CL", "CH", "GP", "GM"];
const CLAY_TYPES = ["CL", "CH"]; // suelos cohesivos: no susceptibles a licuación

function defaultGammas(soil) {
  if (CLAY_TYPES.includes(soil)) return { gNat: 17.5, gSat: 18.5 };
  if (soil === "SM" || soil === "SC") return { gNat: 17.2, gSat: 19.0 };
  return { gNat: 16.9, gSat: 18.5 }; // arenas SP/GP/ML etc.
}

// -------------------------------------------------------------------------
// ROW MANAGEMENT
// -------------------------------------------------------------------------
function addStratum(data) {
  strataIdCounter += 1;
  const soil = (data && data.soil) || "SP";
  const g = defaultGammas(soil);
  strata.push({
    id: strataIdCounter,
    top: data && data.top !== undefined ? data.top : (strata.length ? strata[strata.length - 1].bottom : 0),
    bottom: data && data.bottom !== undefined ? data.bottom : (strata.length ? strata[strata.length - 1].bottom + 2 : 2),
    soil: soil,
    nspt: data && data.nspt !== undefined ? data.nspt : 10,
    fc: data && data.fc !== undefined ? data.fc : 15,
    gNat: data && data.gNat !== undefined ? data.gNat : g.gNat,
    gSat: data && data.gSat !== undefined ? data.gSat : g.gSat,
  });
  renderStrataTable();
}

function deleteStratum(id) {
  strata = strata.filter(s => s.id !== id);
  renderStrataTable();
}

function updateStratum(id, field, value) {
  const s = strata.find(x => x.id === id);
  if (!s) return;
  if (field === "soil") s[field] = value;
  else s[field] = parseFloat(value);
}

// -------------------------------------------------------------------------
// RENDER STRATA INPUT TABLE
// -------------------------------------------------------------------------
function renderStrataTable() {
  const tbody = document.getElementById("strata-tbody");
  tbody.innerHTML = "";
  strata
    .slice()
    .sort((a, b) => a.top - b.top)
    .forEach(s => {
      const tr = document.createElement("tr");

      tr.appendChild(numCell(s, "top", 0.1));
      tr.appendChild(numCell(s, "bottom", 0.1));

      const soilTd = document.createElement("td");
      const select = document.createElement("select");
      SOIL_TYPES.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t; opt.textContent = t;
        if (t === s.soil) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", e => updateStratum(s.id, "soil", e.target.value));
      soilTd.appendChild(select);
      tr.appendChild(soilTd);

      tr.appendChild(numCell(s, "nspt", 1));
      tr.appendChild(numCell(s, "fc", 1));
      tr.appendChild(numCell(s, "gNat", 0.1));
      tr.appendChild(numCell(s, "gSat", 0.1));

      const delTd = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "row-delete";
      delBtn.innerHTML = "✕";
      delBtn.title = "Eliminar estrato";
      delBtn.addEventListener("click", () => deleteStratum(s.id));
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);

      tbody.appendChild(tr);
    });
}

function numCell(s, field, step) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "number";
  input.step = step;
  input.value = s[field];
  input.addEventListener("input", e => updateStratum(s.id, field, e.target.value));
  td.appendChild(input);
  return td;
}

// -------------------------------------------------------------------------
// GLOBAL PARAMS
// -------------------------------------------------------------------------
function getGlobals() {
  return {
    Mw: parseFloat(document.getElementById("in-mw").value) || 8.0,
    amax: parseFloat(document.getElementById("in-amax").value) || 0.4,
    NF: parseFloat(document.getElementById("in-nf").value) || 1.0,
    gammaW: parseFloat(document.getElementById("in-gammaw").value) || 9.81,
    CE: parseFloat(document.getElementById("in-ce").value) || 1.0,
    load: parseFloat(document.getElementById("in-load").value) || 1250,
  };
}

// -------------------------------------------------------------------------
// STRESS INTEGRATION (handles water table crossing within a stratum)
// -------------------------------------------------------------------------
function totalStressAt(depth, sortedStrata, NF) {
  let sigma = 0;
  for (const s of sortedStrata) {
    if (s.top >= depth) break;
    const segTop = s.top;
    const segBottom = Math.min(s.bottom, depth);
    if (segBottom <= segTop) continue;
    if (segBottom <= NF) {
      sigma += s.gNat * (segBottom - segTop);
    } else if (segTop >= NF) {
      sigma += s.gSat * (segBottom - segTop);
    } else {
      sigma += s.gNat * (NF - segTop) + s.gSat * (segBottom - NF);
    }
  }
  return sigma;
}

function poreP(depth, NF, gammaW) {
  return depth > NF ? gammaW * (depth - NF) : 0;
}

// -------------------------------------------------------------------------
// rd — factor de reducción de esfuerzo (Youd et al. 2001, z en metros)
// -------------------------------------------------------------------------
function rdFactor(z) {
  if (z <= 9.15) return 1 - 0.00765 * z;
  if (z <= 23) return 1.174 - 0.0267 * z;
  if (z <= 30) return 0.744 - 0.008 * z;
  return 0.5;
}

// -------------------------------------------------------------------------
// MSF — Magnitude Scaling Factor (Idriss 1999)
// -------------------------------------------------------------------------
function msfFactor(Mw) {
  return Math.min(1.8, 6.9 * Math.exp(-Mw / 4) - 0.058);
}

// -------------------------------------------------------------------------
// Kσ — factor de corrección por esfuerzo de confinamiento (Boulanger & Idriss 2004)
// -------------------------------------------------------------------------
function ksigmaFactor(sigmaV, N1_60cs) {
  const Ncap = Math.min(N1_60cs, 37);
  let Csigma = 1 / (18.9 - 2.55 * Math.sqrt(Ncap));
  Csigma = Math.max(0.08, Math.min(0.3, Csigma));
  let k = 1 - Csigma * Math.log(sigmaV / PA);
  return Math.max(0.4, Math.min(1.1, k));
}

// -------------------------------------------------------------------------
// CRR 7.5 — curva base arena limpia (Youd et al. 2001)
// -------------------------------------------------------------------------
function crr75(N1_60cs) {
  if (N1_60cs >= 30) return null; // no licuable, suelo denso
  return (1 / (34 - N1_60cs)) + (N1_60cs / 135) + (50 / Math.pow(10 * N1_60cs + 45, 2)) - (1 / 200);
}

// -------------------------------------------------------------------------
// Corrección por finos -> (N1)60cs (Youd et al. 2001)
// -------------------------------------------------------------------------
function finesCorrection(N1_60, FC) {
  let alpha, beta;
  if (FC <= 5) { alpha = 0; beta = 1; }
  else if (FC < 35) {
    alpha = Math.exp(1.76 - (190 / (FC * FC)));
    beta = 0.99 + (Math.pow(FC, 1.5) / 1000);
  } else { alpha = 5.0; beta = 1.2; }
  return alpha + beta * N1_60;
}

// -------------------------------------------------------------------------
// MAIN CALCULATION
// -------------------------------------------------------------------------
function calculate() {
  if (strata.length === 0) {
    alert("Agrega al menos un estrato o carga el Caso Grupo 03 antes de calcular.");
    return;
  }
  const g = getGlobals();
  const sorted = strata.slice().sort((a, b) => a.top - b.top);
  const MSF = msfFactor(g.Mw);

  const results = sorted.map(s => {
    const thickness = s.bottom - s.top;
    const z = (s.top + s.bottom) / 2;
    const sigmaV = totalStressAt(z, sorted, g.NF);
    const u = poreP(z, g.NF, g.gammaW);
    const sigmaVeff = Math.max(1, sigmaV - u);

    const isClay = CLAY_TYPES.includes(s.soil);

    const rd = rdFactor(z);
    const CSR = 0.65 * g.amax * (sigmaV / sigmaVeff) * rd;

    const N60 = g.CE * s.nspt;
    const CN = Math.min(1.7, Math.sqrt(PA / sigmaVeff));
    const N1_60 = CN * N60;
    const N1_60cs = finesCorrection(N1_60, s.fc);

    let status, FS, CRR, Ksigma, epsV;

    if (isClay) {
      status = "nosusc";
      FS = null; CRR = null; Ksigma = null; epsV = 0;
    } else {
      CRR = crr75(N1_60cs);
      if (CRR === null) {
        status = "nosusc"; // suelo denso, no licuable
        FS = null; Ksigma = null; epsV = 0;
      } else {
        Ksigma = ksigmaFactor(sigmaVeff, N1_60cs);
        FS = (CRR * MSF * Ksigma) / CSR;
        status = FS < 1.0 ? "liqua" : "noliqua";

        // Asentamiento post-licuación: estimación simplificada educativa
        // basada en la forma de las curvas de Ishihara & Yoshimine (1992)
        if (status === "liqua") {
          const Fcap = Math.min(FS, 2.0);
          const severity = Math.max(0, Math.min(1.5, (1 / Fcap) - 0.5));
          let ev = 1.6 * Math.exp(-0.37 * Math.sqrt(Math.min(N1_60cs, 20))) * severity;
          ev = Math.max(0, Math.min(4.0, ev));
          epsV = ev;
        } else {
          epsV = 0;
        }
      }
    }

    const settlementCm = (epsV / 100) * thickness * 100; // cm

    return {
      ...s, thickness, z, sigmaV, sigmaVeff, rd, CSR,
      N60, N1_60, N1_60cs, CRR, Ksigma, FS, status, epsV, settlementCm
    };
  });

  lastResults = { results, globals: g, MSF };
  renderAll(lastResults);
}

// -------------------------------------------------------------------------
// RENDER: results table + summary + badge
// -------------------------------------------------------------------------
function statusLabel(st) {
  if (st === "liqua") return "LICUA";
  if (st === "noliqua") return "NO LICUA";
  return "NO SUSCEPTIBLE";
}
function statusClass(st) {
  if (st === "liqua") return "status-liqua";
  if (st === "noliqua") return "status-noliqua";
  return "status-nosusc";
}
function rowClass(st) {
  if (st === "liqua") return "row-liqua";
  if (st === "noliqua") return "row-noliqua";
  return "";
}
function fmt(v, d = 2) { return (v === null || v === undefined || isNaN(v)) ? "—" : v.toFixed(d); }

function renderResultsTable(data) {
  const tbody = document.getElementById("results-tbody");
  tbody.innerHTML = "";
  data.results.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.className = rowClass(r.status);
    tr.innerHTML = `
      <td>E${i + 1} · ${fmt(r.top,1)}–${fmt(r.bottom,1)}m (${r.soil})</td>
      <td>${fmt(r.z, 1)}</td>
      <td>${fmt(r.sigmaV, 1)}</td>
      <td>${fmt(r.sigmaVeff, 1)}</td>
      <td>${fmt(r.rd, 3)}</td>
      <td>${fmt(r.CSR, 3)}</td>
      <td>${fmt(r.N1_60cs, 1)}</td>
      <td>${r.CRR === null ? "—" : fmt(r.CRR, 3)}</td>
      <td>${r.Ksigma === null ? "—" : fmt(r.Ksigma, 2)}</td>
      <td class="fs-cell">${r.FS === null ? "—" : fmt(r.FS, 2)}</td>
      <td class="status-cell ${statusClass(r.status)}">${statusLabel(r.status)}</td>
      <td>${fmt(r.epsV, 2)}</td>
      <td>${fmt(r.settlementCm, 2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSummary(data) {
  const liquaLayers = data.results.filter(r => r.status === "liqua");
  const totalThickness = liquaLayers.reduce((sum, r) => sum + r.thickness, 0);
  const totalSettlement = data.results.reduce((sum, r) => sum + r.settlementCm, 0);
  const maxDepth = liquaLayers.length ? Math.max(...liquaLayers.map(r => r.bottom)) : 0;

  document.getElementById("sum-thickness").textContent = totalThickness > 0 ? `${totalThickness.toFixed(1)} m` : "0 m (no licua)";
  document.getElementById("sum-settlement").textContent = `${totalSettlement.toFixed(1)} cm`;
  document.getElementById("sum-depth").textContent = maxDepth > 0 ? `${maxDepth.toFixed(1)} m` : "—";

  const validFS = data.results.filter(r => r.FS !== null).map(r => r.FS);
  const badge = document.getElementById("fs-min-value");
  if (validFS.length === 0) {
    badge.textContent = "—"; badge.className = "badge-value";
  } else {
    const minFS = Math.min(...validFS);
    badge.textContent = minFS.toFixed(2);
    badge.className = "badge-value " + (minFS < 1.0 ? "is-danger" : "is-safe");
  }
}

// -------------------------------------------------------------------------
// SVG BOREHOLE LOG + FS CHART
// -------------------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function statusColor(st) {
  if (st === "liqua") return "#B23A2E";
  if (st === "noliqua") return "#43714F";
  return "#8A8B85";
}
function statusColorSoft(st) {
  if (st === "liqua") return "#F3DAD6";
  if (st === "noliqua") return "#DCE7DC";
  return "#E6E4DD";
}

function drawVisuals(data) {
  const results = data.results;
  const maxDepth = Math.max(...results.map(r => r.bottom));
  const topMargin = 20, bottomMargin = 30;
  const chartHeight = 440;
  const pxPerMeter = chartHeight / maxDepth;
  const totalHeight = topMargin + chartHeight + bottomMargin;
  const depthToY = d => topMargin + d * pxPerMeter;

  // ---------- BOREHOLE ----------
  const boreW = 190, boreColX = 46, boreColW = 90;
  const bh = document.getElementById("svg-borehole");
  bh.setAttribute("viewBox", `0 0 ${boreW} ${totalHeight}`);
  bh.innerHTML = "";

  // depth axis ticks
  const tickStep = maxDepth > 20 ? 5 : 2;
  for (let d = 0; d <= maxDepth; d += tickStep) {
    const y = depthToY(d);
    bh.appendChild(el("line", { x1: boreColX - 6, y1: y, x2: boreColX, y2: y, stroke: "#5B655F", "stroke-width": 1 }));
    const txt = el("text", { x: boreColX - 10, y: y + 3, "text-anchor": "end", "font-size": "9", "font-family": "IBM Plex Mono", fill: "#5B655F" });
    txt.textContent = d + "m";
    bh.appendChild(txt);
  }

  // strata rects
  results.forEach(r => {
    const y1 = depthToY(r.top), y2 = depthToY(r.bottom);
    const rect = el("rect", {
      x: boreColX, y: y1, width: boreColW, height: Math.max(1, y2 - y1),
      fill: statusColorSoft(r.status), stroke: statusColor(r.status), "stroke-width": 1.2
    });
    bh.appendChild(rect);

    if (y2 - y1 > 16) {
      const label = el("text", {
        x: boreColX + boreColW / 2, y: (y1 + y2) / 2 + 3, "text-anchor": "middle",
        "font-size": "10", "font-family": "IBM Plex Mono", fill: "#1E2422", "font-weight": "600"
      });
      label.textContent = `${r.soil} · N=${r.nspt}`;
      bh.appendChild(label);
    }
  });

  // water table marker
  if (data.globals.NF <= maxDepth) {
    const yNF = depthToY(data.globals.NF);
    bh.appendChild(el("line", { x1: boreColX - 2, y1: yNF, x2: boreColX + boreColW + 2, y2: yNF, stroke: "#C68A2E", "stroke-width": 1.5, "stroke-dasharray": "4 2" }));
    const tri = el("polygon", { points: `${boreColX + boreColW + 8},${yNF} ${boreColX + boreColW + 16},${yNF - 5} ${boreColX + boreColW + 16},${yNF + 5}`, fill: "#C68A2E" });
    bh.appendChild(tri);
  }

  bh.appendChild(el("rect", { x: boreColX, y: topMargin, width: boreColW, height: chartHeight, fill: "none", stroke: "#1E2422", "stroke-width": 1.4 }));

  // ---------- FS CHART ----------
  const chartW = 420;
  const chart = document.getElementById("svg-fschart");
  chart.setAttribute("viewBox", `0 0 ${chartW} ${totalHeight}`);
  chart.innerHTML = "";

  const plotX = 34, plotW = chartW - plotX - 20;
  const maxFS = Math.max(2.2, ...results.filter(r => r.FS !== null).map(r => r.FS)) * 1.05;
  const fsToX = fs => plotX + (Math.min(fs, maxFS) / maxFS) * plotW;

  // gridlines + x axis labels
  const fsStep = maxFS > 4 ? 1 : 0.5;
  for (let f = 0; f <= maxFS; f += fsStep) {
    const x = fsToX(f);
    chart.appendChild(el("line", { x1: x, y1: topMargin, x2: x, y2: topMargin + chartHeight, stroke: "#DDD8CB", "stroke-width": 1 }));
    const t = el("text", { x: x, y: topMargin + chartHeight + 14, "text-anchor": "middle", "font-size": "9", "font-family": "IBM Plex Mono", fill: "#5B655F" });
    t.textContent = f.toFixed(1);
    chart.appendChild(t);
  }
  // reference line FS = 1
  const xRef = fsToX(1);
  chart.appendChild(el("line", { x1: xRef, y1: topMargin, x2: xRef, y2: topMargin + chartHeight, stroke: "#B23A2E", "stroke-width": 1.5, "stroke-dasharray": "5 3" }));
  const refLabel = el("text", { x: xRef, y: topMargin - 6, "text-anchor": "middle", "font-size": "9.5", "font-family": "IBM Plex Mono", fill: "#B23A2E", "font-weight": "600" });
  refLabel.textContent = "FS=1.0";
  chart.appendChild(refLabel);

  // depth axis ticks (right side shares same scale)
  for (let d = 0; d <= maxDepth; d += tickStep) {
    const y = depthToY(d);
    chart.appendChild(el("line", { x1: plotX, y1: y, x2: plotX + plotW, y2: y, stroke: "#EFEDE4", "stroke-width": 1 }));
  }

  // step polyline for FS vs depth
  let prevX = null;
  results.forEach(r => {
    const y1 = depthToY(r.top), y2 = depthToY(r.bottom);
    const fsVal = r.FS === null ? maxFS : r.FS;
    const x = fsToX(fsVal);
    const color = statusColor(r.status);

    if (prevX !== null) {
      chart.appendChild(el("line", { x1: prevX, y1: y1, x2: x, y2: y1, stroke: "#8A8B85", "stroke-width": 1, "stroke-dasharray": "2 2" }));
    }
    chart.appendChild(el("line", { x1: x, y1: y1, x2: x, y2: y2, stroke: color, "stroke-width": 3, "stroke-linecap": "round" }));
    chart.appendChild(el("circle", { cx: x, cy: (y1 + y2) / 2, r: 3, fill: color }));
    prevX = x;
  });

  chart.appendChild(el("rect", { x: plotX, y: topMargin, width: plotW, height: chartHeight, fill: "none", stroke: "#1E2422", "stroke-width": 1.4 }));
}

// -------------------------------------------------------------------------
// SOLUTIONS: Columnas de Grava & Grupo de Pilotes
// -------------------------------------------------------------------------
function metricBox(label, value) {
  return `<div class="metric-box"><span class="m-label">${label}</span><span class="m-value">${value}</span></div>`;
}

function renderSolutions(data) {
  const liquaLayers = data.results.filter(r => r.status === "liqua");

  if (liquaLayers.length === 0) {
    document.getElementById("grava-metrics").innerHTML = `<div class="metric-box" style="grid-column:1/3"><span class="m-label">Resultado</span><span class="m-value">No se requiere mejora — ningún estrato licua</span></div>`;
    document.getElementById("pilotes-metrics").innerHTML = `<div class="metric-box" style="grid-column:1/3"><span class="m-label">Resultado</span><span class="m-value">Cimentación superficial viable</span></div>`;
    return;
  }

  // ---- Columnas de grava (estimación de mejora) ----
  const avgN1_60cs = liquaLayers.reduce((s, r) => s + r.N1_60cs, 0) / liquaLayers.length;
  const improvedN1_60cs = avgN1_60cs + 9; // incremento típico por densificación, ar~0.20-0.25
  const improvedCRR = crr75(Math.min(improvedN1_60cs, 29.9));
  const avgCSR = liquaLayers.reduce((s, r) => s + r.CSR, 0) / liquaLayers.length;
  const improvedFS = improvedCRR !== null ? (improvedCRR * data.MSF * 1.0) / avgCSR : null;

  document.getElementById("grava-metrics").innerHTML =
    metricBox("Espesor a tratar", `${liquaLayers.reduce((s, r) => s + r.thickness, 0).toFixed(1)} m`) +
    metricBox("(N1)60cs promedio actual", avgN1_60cs.toFixed(1)) +
    metricBox("(N1)60cs estimado mejorado", improvedN1_60cs.toFixed(1)) +
    metricBox("FSlic estimado post-mejora", improvedFS !== null ? improvedFS.toFixed(2) + (improvedFS >= 1 ? " ✓" : " ✗") : "> No licuable");

  // ---- Pilotes (Meyerhof SPT) ----
  const bearing = data.results.find(r => r.status !== "liqua" && r.bottom > Math.max(...liquaLayers.map(l => l.bottom)) - 0.01) ||
                  data.results.filter(r => r.status !== "liqua").pop();

  const Nb = bearing ? bearing.nspt : 30;
  const D = 0.6; // diámetro asumido, m
  const Ap = Math.PI * D * D / 4;
  const Lb = 3 * D; // empotramiento en estrato competente
  const qp = Math.min(40 * Nb * (Lb / D), 400 * Nb); // kPa
  const Qp = qp * Ap; // kN

  const perimeter = Math.PI * D;
  const fs_shaft = 2 * Nb; // kPa, fricción solo en el tramo competente (se ignora en zona licuada)
  const Qs = fs_shaft * perimeter * Lb; // kN

  const QultKN = Qp + Qs;
  const QultTon = QultKN / 9.81;
  const FSpile = 2.5;
  const QadmTon = QultTon / FSpile;

  const groupEfficiency = 0.80;
  const requiredCapacity = data.globals.load / groupEfficiency;
  const nPiles = Math.max(1, Math.ceil(requiredCapacity / QadmTon));

  document.getElementById("pilotes-metrics").innerHTML =
    metricBox("Estrato de apoyo (N campo)", Nb.toFixed(0)) +
    metricBox("Diámetro asumido", `${D.toFixed(2)} m`) +
    metricBox("Q admisible / pilote", `${QadmTon.toFixed(1)} ton`) +
    metricBox("N.° de pilotes requeridos", `${nPiles} (η=${(groupEfficiency*100).toFixed(0)}%)`);
}

// -------------------------------------------------------------------------
// RENDER ALL
// -------------------------------------------------------------------------
function renderAll(data) {
  document.getElementById("empty-state").classList.add("results-hidden");
  document.getElementById("visual-panel").classList.remove("results-hidden");
  document.getElementById("table-panel").classList.remove("results-hidden");
  document.getElementById("solutions-panel").classList.remove("results-hidden");

  renderResultsTable(data);
  renderSummary(data);
  drawVisuals(data);
  renderSolutions(data);
}

// -------------------------------------------------------------------------
// PRESET: CASO GRUPO 03 — licuefacción alta hasta 19 m
// -------------------------------------------------------------------------
function loadGrupo03() {
  strata = [];
  strataIdCounter = 0;

  document.getElementById("in-mw").value = 8.0;
  document.getElementById("in-amax").value = 0.42;
  document.getElementById("in-nf").value = 1.0;
  document.getElementById("in-gammaw").value = 9.81;
  document.getElementById("in-ce").value = 1.0;
  document.getElementById("in-load").value = 1250;

  const preset = [
    { top: 0.0, bottom: 2.0, soil: "SM", nspt: 6, fc: 30, gNat: 16.9, gSat: 18.0 },
    { top: 2.0, bottom: 6.0, soil: "SP", nspt: 7, fc: 4, gNat: 16.9, gSat: 18.0 },
    { top: 6.0, bottom: 11.0, soil: "SP-SM", nspt: 9, fc: 14, gNat: 17.0, gSat: 18.2 },
    { top: 11.0, bottom: 15.0, soil: "SM", nspt: 8, fc: 26, gNat: 17.0, gSat: 18.3 },
    { top: 15.0, bottom: 19.0, soil: "SP", nspt: 12, fc: 8, gNat: 17.2, gSat: 18.5 },
    { top: 19.0, bottom: 22.0, soil: "SM", nspt: 40, fc: 15, gNat: 18.5, gSat: 19.1 },
    { top: 22.0, bottom: 25.0, soil: "CL", nspt: 40, fc: 55, gNat: 18.0, gSat: 19.0 },
  ];
  preset.forEach(p => {
    strataIdCounter += 1;
    strata.push({ id: strataIdCounter, ...p });
  });
  renderStrataTable();
  calculate();
}

// -------------------------------------------------------------------------
// INIT
// -------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-add-row").addEventListener("click", () => addStratum());
  document.getElementById("btn-load-preset").addEventListener("click", loadGrupo03);
  document.getElementById("btn-calculate").addEventListener("click", calculate);

  // start with two blank example rows so the table isn't empty
  addStratum({ top: 0, bottom: 3, soil: "SP", nspt: 8, fc: 10 });
  addStratum({ top: 3, bottom: 7, soil: "SM", nspt: 15, fc: 20 });
});