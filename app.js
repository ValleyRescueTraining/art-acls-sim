import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js";

const firebaseConfig = window.VRT_FIREBASE_CONFIG;

const DEFAULT_STATE = {
  rhythm: "NSR",
  hr: 78,
  pulseRate: 78,
  perfusion: 80,
  spo2: 98,
  etco2: 36,
  rr: 14,
  charged: false
};

const RHYTHMS = [
  "NSR",
  "Sinus Tach",
  "Sinus Brady",
  "Atrial Fib",
  "SVT",
  "VTach",
  "VFib",
  "Torsades",
  "Asystole",
  "PEA"
];

function getSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session") || "default";
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rhythmShortName(name) {
  if (name === "VFib") return "VF";
  if (name === "VTach") return "VT";
  if (name === "Atrial Fib") return "A Fib";
  return name;
}

function gaussian(x, mu, sigma, amp) {
  const z = (x - mu) / sigma;
  return amp * Math.exp(-0.5 * z * z);
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const sessionId = getSessionId();
const sessionRef = ref(db, `sessions/${sessionId}`);

let state = { ...DEFAULT_STATE };
let ecgCanvas, plethCanvas, capnoCanvas;
let ecgCtx, plethCtx, capnoCtx;
let lastFrame = performance.now();
let ecgPhase = 0;
let plethPhase = 0;
let capnoPhase = 0;

function hideWarningIfPresent() {
  const els = [...document.querySelectorAll("div, p, span")];
  const warn = els.find(el => (el.textContent || "").includes("Firebase config error"));
  if (warn) warn.style.display = "none";
}

function setSessionText() {
  const els = [...document.querySelectorAll("div, p, span")];
  els.forEach(el => {
    const t = (el.textContent || "").trim();
    if (t === "Session:" || t.startsWith("Session:")) {
      el.textContent = `Session: ${sessionId}`;
    }
  });
}

async function ensureSessionExists() {
  const snap = await get(sessionRef);
  if (!snap.exists()) {
    await set(sessionRef, { ...DEFAULT_STATE });
  }
}

function writePatch(patch) {
  return update(sessionRef, patch).catch(err => console.error(err));
}

function findWaveformPanels() {
  const boxes = [...document.querySelectorAll("div")].filter(el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 150 &&
      rect.height > 80 &&
      style.backgroundColor === "rgb(0, 0, 0)";
  });
  return boxes.slice(0, 3);
}

function makeCanvas(panel) {
  panel.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = Math.max(300, panel.clientWidth * 2);
  c.height = Math.max(120, panel.clientHeight * 2);
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.display = "block";
  panel.appendChild(c);
  return c;
}

function drawGrid(ctx, w, h) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(100,140,140,0.15)";
  ctx.lineWidth = 1;

  const small = 28;
  for (let x = 0; x < w; x += small) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += small) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function setupStudentCanvases() {
  const panels = findWaveformPanels();
  if (panels.length < 3) return false;

  ecgCanvas = makeCanvas(panels[0]);
  plethCanvas = makeCanvas(panels[1]);
  capnoCanvas = makeCanvas(panels[2]);

  ecgCtx = ecgCanvas.getContext("2d");
  plethCtx = plethCanvas.getContext("2d");
  capnoCtx = capnoCanvas.getContext("2d");

  drawGrid(ecgCtx, ecgCanvas.width, ecgCanvas.height);
  drawGrid(plethCtx, plethCanvas.width, plethCanvas.height);
  drawGrid(capnoCtx, capnoCanvas.width, capnoCanvas.height);

  return true;
}

function ecgSample(dt) {
  const rhythm = state.rhythm;
  const hr = clamp(state.hr, 20, 220);

  if (rhythm === "Asystole") return 0;

  if (rhythm === "VFib") {
    ecgPhase += dt * 10;
    return 0.25 * Math.sin(ecgPhase * 9) + 0.15 * Math.sin(ecgPhase * 16);
  }

  if (rhythm === "Torsades") {
    ecgPhase += dt * 9;
    return (0.15 + 0.25 * (0.5 + 0.5 * Math.sin(ecgPhase * 0.8))) * Math.sin(ecgPhase * 11);
  }

  const beatPeriod = 60 / hr;
  ecgPhase += dt / beatPeriod;
  const p = ecgPhase % 1;

  if (rhythm === "VTach") {
    return gaussian(p, 0.50, 0.035, 1.0) - gaussian(p, 0.56, 0.02, 0.25);
  }

  let y = 0;
  if (rhythm !== "Atrial Fib") {
    y += gaussian(p, 0.18, 0.018, 0.09);
  } else {
    y += 0.02 * Math.sin(p * 50);
  }

  y -= gaussian(p, 0.39, 0.008, 0.14);
  y += gaussian(p, 0.42, 0.010, 0.95);
  y -= gaussian(p, 0.45, 0.012, 0.28);
  y += gaussian(p, 0.68, 0.04, 0.22);

  if (rhythm === "SVT") y *= 0.95;
  if (rhythm === "Sinus Tach") y *= 0.98;
  if (rhythm === "Sinus Brady") y *= 1.02;

  return y;
}

function plethSample(dt) {
  const pulseRate = clamp(state.pulseRate, 0, 220);
  const perf = clamp(state.perfusion / 100, 0, 1);

  if (pulseRate < 5 || perf < 0.05) return 0;

  const beatPeriod = 60 / pulseRate;
  plethPhase += dt / beatPeriod;
  const p = plethPhase % 1;

  let y = 0;
  if (p < 0.14) y = p / 0.14;
  else if (p < 0.42) y = 1 - (p - 0.14) * 1.4;
  else if (p < 0.52) y = 0.55 + (p - 0.42) * 1.2;
  else y = 0.67 - (p - 0.52) * 1.2;

  return Math.max(0, y) * perf;
}

function capnoSample(dt) {
  const rr = clamp(state.rr, 4, 40);
  const amp = clamp(state.etco2 / 45, 0, 1.2);

  const breathPeriod = 60 / rr;
  capnoPhase += dt / breathPeriod;
  const p = capnoPhase % 1;

  let y = 0;
  if (p < 0.14) y = 0.05;
  else if (p < 0.32) y = (p - 0.14) / 0.18;
  else if (p < 0.62) y = 0.95;
  else if (p < 0.82) y = 0.95 - ((p - 0.62) / 0.20) * 0.9;
  else y = 0.05;

  return y * amp;
}

function scrollDraw(ctx, canvas, prevObj, sample, color, scale = 0.35) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.drawImage(canvas, -2, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(w - 2, 0, 2, h);

  const y = h * 0.5 - sample * h * scale;

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w - 3, prevObj.y ?? y);
  ctx.lineTo(w - 1, y);
  ctx.stroke();

  prevObj.y = y;
}

function setTextByContains(textStartsWith, value) {
  const els = [...document.querySelectorAll("div, p, span")];
  const el = els.find(x => (x.textContent || "").trim().startsWith(textStartsWith));
  if (el) el.textContent = `${textStartsWith} ${value}`;
}

function updateStudentLabels() {
  setSessionText();
  hideWarningIfPresent();

  const els = [...document.querySelectorAll("div, p, span")];

  const hrCard = els.find(el => (el.textContent || "").trim() === "HR");
  if (hrCard) {
    const parent = hrCard.parentElement;
    const nums = [...parent.querySelectorAll("div, p, span")].filter(el => /^\d+$/.test((el.textContent || "").trim()));
    if (nums[0]) nums[0].textContent = String(state.hr);
  }

  const spoCard = els.find(el => (el.textContent || "").includes("SpO"));
  if (spoCard) {
    const parent = spoCard.parentElement;
    const nums = [...parent.querySelectorAll("div, p, span")].filter(el => /^\d+$/.test((el.textContent || "").trim()));
    if (nums[0]) nums[0].textContent = String(state.spo2);
  }

  const etcoCard = els.find(el => (el.textContent || "").includes("EtCO"));
  if (etcoCard) {
    const parent = etcoCard.parentElement;
    const nums = [...parent.querySelectorAll("div, p, span")].filter(el => /^\d+$/.test((el.textContent || "").trim()));
    if (nums[0]) nums[0].textContent = String(state.etco2);
  }

  const rhythmChip = els.find(el => {
    const t = (el.textContent || "").trim();
    return RHYTHMS.includes(t) || ["NSR", "VF", "VT", "A Fib"].includes(t);
  });
  if (rhythmChip) rhythmChip.textContent = rhythmShortName(state.rhythm);
}

function animateStudent(now) {
  if (!ecgCanvas || !plethCanvas || !capnoCanvas) {
    if (!setupStudentCanvases()) {
      requestAnimationFrame(animateStudent);
      return;
    }
  }

  const dt = Math.min(0.04, (now - lastFrame) / 1000);
  lastFrame = now;

  const e = ecgSample(dt);
  const p = plethSample(dt);
  const c = capnoSample(dt);

  scrollDraw(ecgCtx, ecgCanvas, animateStudent.ecgPrev ||= {}, e, "#7CFF9E", 0.32);
  scrollDraw(plethCtx, plethCanvas, animateStudent.plethPrev ||= {}, p, "#76B8FF", 0.28);
  scrollDraw(capnoCtx, capnoCanvas, animateStudent.capnoPrev ||= {}, c, "#FFD95C", 0.30);

  requestAnimationFrame(animateStudent);
}

function bindInstructorControls() {
  hideWarningIfPresent();
  setSessionText();

  const select = document.querySelector("select");
  if (select && select.options.length === 0) {
    RHYTHMS.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
  }

  if (select) select.value = state.rhythm;

  const buttons = [...document.querySelectorAll("button")];
  const applyRhythmBtn = buttons.find(b => (b.textContent || "").includes("Apply Rhythm"));

  if (applyRhythmBtn && select) {
    applyRhythmBtn.onclick = () => {
      writePatch({ rhythm: select.value });
    };
  }

  const ranges = [...document.querySelectorAll('input[type="range"]')];
  if (ranges.length >= 5) {
    const [hr, pulse, perf, spo2, etco2] = ranges;

    hr.value = state.hr;
    pulse.value = state.pulseRate;
    perf.value = state.perfusion;
    spo2.value = state.spo2;
    etco2.value = state.etco2;

    const push = () => {
      writePatch({
        hr: Number(hr.value),
        pulseRate: Number(pulse.value),
        perfusion: Number(perf.value),
        spo2: Number(spo2.value),
        etco2: Number(etco2.value)
      });
    };

    ranges.forEach(r => {
      r.addEventListener("input", push);
      r.addEventListener("change", push);
    });
  }
}

function bootFirebase() {
  onValue(sessionRef, snap => {
    const data = snap.val();
    if (!data) return;
    state = { ...DEFAULT_STATE, ...data };

    if (window.location.pathname.includes("student")) {
      updateStudentLabels();
    }
    if (window.location.pathname.includes("instructor")) {
      bindInstructorControls();
    }
  });
}

(async function boot() {
  await ensureSessionExists();
  bootFirebase();

  if (window.location.pathname.includes("student")) {
    updateStudentLabels();
    requestAnimationFrame(animateStudent);
  }

  if (window.location.pathname.includes("instructor")) {
    bindInstructorControls();
  }
})();