import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

const RHYTHMS = [
  "NSR", "Sinus Brady", "Sinus Tach", "SVT", "A-Fib", "A-Flutter",
  "Junctional", "Idioventricular", "PEA", "Asystole",
  "VF Coarse", "VF Fine", "VT Pulseless", "VT With Pulse", "Torsades"
];

const PRESETS = {
  vf_arrest: {
    rhythm: "VF Coarse", heartRate: 220, pulseRate: 0, perfusion: 0, spo2: 0, etco2: 8, rr: 0, cpr: false
  },
  unstable_vt: {
    rhythm: "VT With Pulse", heartRate: 180, pulseRate: 160, perfusion: 35, spo2: 93, etco2: 24, rr: 24, cpr: false
  },
  symptomatic_brady: {
    rhythm: "Sinus Brady", heartRate: 32, pulseRate: 32, perfusion: 45, spo2: 95, etco2: 30, rr: 16, cpr: false
  },
  pea_arrest: {
    rhythm: "PEA", heartRate: 70, pulseRate: 0, perfusion: 0, spo2: 0, etco2: 7, rr: 0, cpr: false
  },
  rosc_watch: {
    rhythm: "NSR", heartRate: 88, pulseRate: 88, perfusion: 78, spo2: 98, etco2: 36, rr: 14, cpr: false
  }
};

const DEFAULT_STATE = {
  rhythm: "NSR",
  heartRate: 78,
  pulseRate: 78,
  perfusion: 80,
  spo2: 98,
  etco2: 36,
  rr: 14,
  systolic: 126,
  diastolic: 78,
  cpr: false,
  paced: false,
  paceRate: 70,
  paceCurrent: 40,
  charged: false,
  energy: 200,
  sync: false,
  timestamp: Date.now()
};

function qs(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function ensureConfig() {
  if (!window.VRT_FIREBASE_CONFIG || window.VRT_FIREBASE_CONFIG.apiKey === "PASTE_YOURS_HERE") {
    throw new Error("Firebase config missing. Paste your config into firebase-config.js first.");
  }
}

function buildClient() {
  ensureConfig();
  const app = initializeApp(window.VRT_FIREBASE_CONFIG);
  const db = getDatabase(app);
  const session = qs("session") || "demo-alpha";
  const stateRef = ref(db, `sessions/${session}/state`);
  const metaRef = ref(db, `sessions/${session}/meta`);
  return { db, session, stateRef, metaRef };
}

function lineColor(type) {
  return type === "ecg" ? "#42ff91" : type === "pleth" ? "#68c1ff" : "#ffd85a";
}

function drawWave(canvas, samples, color) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width * dpr);
  canvas.height = Math.max(90, rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = (h / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((v, i) => {
    const x = (i / (samples.length - 1)) * w;
    const y = h * (0.5 - v * 0.38);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function buildEcg(state, n = 280) {
  const arr = [];
  const rate = Math.max(20, state.heartRate || 60);
  const beatsAcross = Math.max(1.2, Math.min(6, rate / 24));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * beatsAcross;
    const cycle = t % 1;
    let v = 0;
    const rhythm = state.rhythm;
    if (rhythm === "Asystole") {
      v = Math.sin(i * 0.08) * 0.01;
    } else if (rhythm === "VF Coarse" || rhythm === "VF Fine") {
      const amp = rhythm === "VF Coarse" ? 0.35 : 0.18;
      v = amp * (Math.sin(t * 18) + 0.45 * Math.sin(t * 31));
    } else if (rhythm === "Torsades") {
      const env = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2.1));
      v = env * Math.sin(t * 22);
    } else {
      if (cycle > 0.13 && cycle < 0.18 && !["A-Fib", "Junctional", "Idioventricular", "VT Pulseless", "VT With Pulse"].includes(rhythm)) {
        v += 0.08 * Math.sin(((cycle - 0.13) / 0.05) * Math.PI);
      }
      if (cycle > 0.22 && cycle < 0.235) v -= 0.14;
      if (cycle > 0.235 && cycle < 0.255) v += (["VT Pulseless", "VT With Pulse", "Idioventricular"].includes(rhythm) ? 0.55 : 0.78);
      if (cycle > 0.255 && cycle < 0.28) v -= 0.2;
      if (cycle > 0.42 && cycle < 0.56) v += 0.18 * Math.sin(((cycle - 0.42) / 0.14) * Math.PI);
      if (rhythm === "A-Fib") v += (Math.sin(i * 0.5) + Math.sin(i * 0.13)) * 0.02;
      if (rhythm === "A-Flutter") v += 0.03 * Math.sin(t * 28);
      if (rhythm === "SVT") v *= 0.9;
      if (rhythm === "VT Pulseless" || rhythm === "VT With Pulse") v *= 1.1;
      if (rhythm === "Idioventricular") v *= 0.95;
      if (rhythm === "PEA") v *= 0.85;
    }
    if (state.cpr) v += Math.sin(i * 0.6) * 0.08;
    if (state.paced && state.paceCurrent > 10 && i % Math.max(8, Math.floor(280 / Math.max(40, state.paceRate))) === 0) v += 0.35;
    arr.push(v);
  }
  return arr;
}

function buildPleth(state, n = 280) {
  const arr = [];
  const perf = Math.max(0, Math.min(100, state.perfusion || 0)) / 100;
  const pulse = Math.max(0, state.pulseRate || 0);
  const beatsAcross = pulse > 0 ? Math.max(0.6, Math.min(5, pulse / 24)) : 0.4;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * beatsAcross + 0.22;
    const cycle = t % 1;
    let v = 0;
    if (pulse > 0 && perf > 0.02) {
      if (cycle < 0.18) v = (cycle / 0.18) ** 1.6;
      else if (cycle < 0.44) v = 1 - ((cycle - 0.18) / 0.26) * 0.45;
      else if (cycle < 0.6) v = 0.58 + 0.1 * Math.sin(((cycle - 0.44) / 0.16) * Math.PI);
      else v = Math.max(0, 0.45 - ((cycle - 0.6) / 0.4) * 0.45);
      v *= 0.85 * perf;
    }
    arr.push(v);
  }
  return arr;
}

function buildCapno(state, n = 280) {
  const arr = [];
  const rr = Math.max(1, state.rr || 10);
  const breathsAcross = Math.max(0.8, Math.min(4, rr / 6));
  const amp = Math.max(0.08, Math.min(1, (state.etco2 || 30) / 45));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * breathsAcross;
    const cycle = t % 1;
    let v = 0;
    if (cycle < 0.18) v = 0;
    else if (cycle < 0.34) v = ((cycle - 0.18) / 0.16) * amp;
    else if (cycle < 0.68) v = amp * (0.92 + 0.04 * Math.sin(i * 0.03));
    else if (cycle < 0.86) v = amp * (1 - ((cycle - 0.68) / 0.18));
    arr.push(v);
  }
  return arr;
}

async function ensureSession(client) {
  const snap = await get(client.stateRef);
  if (!snap.exists()) {
    await set(client.stateRef, DEFAULT_STATE);
    await set(client.metaRef, { createdAt: Date.now(), version: 1 });
  }
}

function mountStudent() {
  const client = buildClient();
  ensureSession(client).catch(showError);
  const sessionEl = document.getElementById("sessionLabel");
  sessionEl.textContent = client.session;
  const ecgCanvas = document.getElementById("ecgWave");
  const plethCanvas = document.getElementById("plethWave");
  const capnoCanvas = document.getElementById("capnoWave");

  onValue(client.stateRef, (snap) => {
    const state = { ...DEFAULT_STATE, ...(snap.val() || {}) };
    document.getElementById("rhythmLabel").textContent = state.rhythm;
    document.getElementById("hrValue").textContent = state.heartRate;
    document.getElementById("spo2Value").textContent = state.spo2 > 0 ? `${state.spo2}` : "--";
    document.getElementById("etco2Value").textContent = state.etco2 > 0 ? `${state.etco2}` : "--";
    document.getElementById("rrValue").textContent = state.rr;
    document.getElementById("bpValue").textContent = `${state.systolic}/${state.diastolic}`;
    document.getElementById("statusValue").textContent = state.cpr ? "CPR ACTIVE" : state.paced ? `PACER ${state.paceRate} PPM` : "MONITORING";
    drawWave(ecgCanvas, buildEcg(state), lineColor("ecg"));
    drawWave(plethCanvas, buildPleth(state), lineColor("pleth"));
    drawWave(capnoCanvas, buildCapno(state), lineColor("capno"));
  });
}

function mountInstructor() {
  const client = buildClient();
  ensureSession(client).catch(showError);
  const sessionEl = document.getElementById("sessionLabel");
  sessionEl.textContent = client.session;

  const rhythmSelect = document.getElementById("rhythmSelect");
  RHYTHMS.forEach((r) => {
    const opt = document.createElement("option"); opt.value = r; opt.textContent = r; rhythmSelect.appendChild(opt);
  });

  const fields = ["heartRate", "pulseRate", "perfusion", "spo2", "etco2", "rr", "systolic", "diastolic", "paceRate", "paceCurrent", "energy"];
  const sliders = fields.map((id) => document.getElementById(id)).filter(Boolean);

  onValue(client.stateRef, (snap) => {
    const state = { ...DEFAULT_STATE, ...(snap.val() || {}) };
    rhythmSelect.value = state.rhythm;
    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = state[id];
        const out = document.getElementById(`${id}Out`);
        if (out) out.textContent = el.value;
      }
    });
    document.getElementById("cprToggle").checked = !!state.cpr;
    document.getElementById("pacedToggle").checked = !!state.paced;
    document.getElementById("syncToggle").checked = !!state.sync;
    document.getElementById("chargedState").textContent = state.charged ? `Charged: ${state.energy}J` : "Not charged";
  });

  sliders.forEach((el) => {
    el.addEventListener("input", () => {
      const out = document.getElementById(`${el.id}Out`);
      if (out) out.textContent = el.value;
    });
  });

  document.getElementById("applyRhythmBtn").addEventListener("click", async () => {
    await update(client.stateRef, { rhythm: rhythmSelect.value, timestamp: Date.now() });
  });

  document.getElementById("applyVitalsBtn").addEventListener("click", async () => {
    const payload = {};
    fields.forEach((id) => payload[id] = Number(document.getElementById(id).value));
    payload.cpr = document.getElementById("cprToggle").checked;
    payload.paced = document.getElementById("pacedToggle").checked;
    payload.sync = document.getElementById("syncToggle").checked;
    payload.timestamp = Date.now();
    await update(client.stateRef, payload);
  });

  document.getElementById("chargeBtn").addEventListener("click", async () => {
    const energy = Number(document.getElementById("energy").value);
    await update(client.stateRef, { charged: true, energy, timestamp: Date.now() });
  });

  document.getElementById("shockBtn").addEventListener("click", async () => {
    const snap = await get(client.stateRef);
    const state = { ...DEFAULT_STATE, ...(snap.val() || {}) };
    if (!state.charged) return alert("Charge first.");
    let nextRhythm = state.rhythm;
    if (["VF Coarse", "VF Fine", "VT Pulseless"].includes(state.rhythm)) {
      nextRhythm = Math.random() < 0.62 ? "NSR" : (Math.random() < 0.5 ? "PEA" : "Asystole");
    }
    await update(client.stateRef, {
      charged: false,
      rhythm: nextRhythm,
      pulseRate: nextRhythm === "NSR" ? 88 : nextRhythm === "PEA" ? 0 : state.pulseRate,
      perfusion: nextRhythm === "NSR" ? 80 : nextRhythm === "PEA" ? 0 : state.perfusion,
      etco2: nextRhythm === "NSR" ? 34 : nextRhythm === "PEA" ? 8 : state.etco2,
      spo2: nextRhythm === "NSR" ? 98 : nextRhythm === "PEA" ? 0 : state.spo2,
      timestamp: Date.now()
    });
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const preset = PRESETS[btn.dataset.preset];
      if (!preset) return;
      await update(client.stateRef, { ...preset, timestamp: Date.now(), charged: false, paced: false, sync: false });
    });
  });

  document.getElementById("resetBtn").addEventListener("click", async () => {
    await set(client.stateRef, { ...DEFAULT_STATE, timestamp: Date.now() });
  });
}

function showError(err) {
  console.error(err);
  const target = document.getElementById("errorBox");
  if (target) target.textContent = err.message || String(err);
}

const page = document.body.dataset.page;
if (page === "student") mountStudent();
if (page === "instructor") mountInstructor();
