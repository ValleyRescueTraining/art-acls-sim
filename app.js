// Firebase v9+ modular CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js";

// Load config from firebase-config.js
const firebaseConfig = window.VRT_FIREBASE_CONFIG;

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Get session ID from URL
function getSession() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session") || "default";
}

const sessionId = getSession();
const sessionRef = ref(db, "sessions/" + sessionId);

// ---------- INSTRUCTOR SIDE ----------
if (window.location.pathname.includes("instructor")) {

  const rhythmSelect = document.querySelector("select");
  const applyBtn = document.querySelector("button");

  // Populate rhythms
  const rhythms = [
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

  if (rhythmSelect) {
    rhythmSelect.innerHTML = "";
    rhythms.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      rhythmSelect.appendChild(opt);
    });
  }

  if (applyBtn) {
    applyBtn.onclick = () => {
      const selected = rhythmSelect.value;

      set(sessionRef, {
        rhythm: selected,
        hr: 80,
        spo2: 98,
        etco2: 36
      });
    };
  }
}

// ---------- STUDENT SIDE ----------
if (window.location.pathname.includes("student")) {

  const hrEl = document.querySelector("[data-hr]");
  const spo2El = document.querySelector("[data-spo2]");
  const etco2El = document.querySelector("[data-etco2]");

  onValue(sessionRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (hrEl) hrEl.textContent = data.hr;
    if (spo2El) spo2El.textContent = data.spo2;
    if (etco2El) etco2El.textContent = data.etco2;

    console.log("Live update:", data);
  });
}