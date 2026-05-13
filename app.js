import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

// ── EmailJS ───────────────────────────────────────────────────────────────────
const EMAILJS_SERVICE_ID  = "TSA-Sound-Detector";
const EMAILJS_TEMPLATE_ID = "template_fa9wwjj";

async function sendEmail(sound, score) {
  const emailSetting      = document.getElementById("emailSetting");
  const emailAddressInput = document.getElementById("emailAddress");
  if (!emailSetting?.checked) return;
  const toEmail = emailAddressInput?.value.trim();
  if (!toEmail) { addLog("📧 Email failed: no email address entered."); return; }
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      email: toEmail, sound: sound.label, emoji: sound.emoji,
      score: score.toFixed(3), time: new Date().toLocaleString(),
    });
    addLog(`📧 Email sent for ${sound.label} to ${toEmail}`);
  } catch (e) {
    console.error("EmailJS send failed:", e);
    addLog(`📧 Email failed: ${e?.text || e?.message || "unknown error"}`);
  }
}

// ── Auth DOM ──────────────────────────────────────────────────────────────────
const authScreen       = document.getElementById("authScreen");
const mainApp          = document.getElementById("mainApp");
const authErrorEl      = document.getElementById("authError");
const userEmailEl      = document.getElementById("userEmail");
const tabSignIn        = document.getElementById("tabSignIn");
const tabSignUp        = document.getElementById("tabSignUp");
const emailInput       = document.getElementById("emailInput");
const passInput        = document.getElementById("passInput");
const passConfirmInput = document.getElementById("passConfirmInput");
const signInBtn        = document.getElementById("signInBtn");
const signUpBtn        = document.getElementById("signUpBtn");
const signOutBtn       = document.getElementById("signOutBtn");

function authErr(msg) {
  authErrorEl.textContent = msg;
  authErrorEl.style.display = msg ? "block" : "none";
}
function setBusy(btn, busy) {
  btn.disabled = busy;
  if (!btn._t) btn._t = btn.textContent;
  btn.textContent = busy ? "Please wait…" : btn._t;
}
function niceError(code) {
  return ({
    "auth/user-not-found":         "No account found with that email.",
    "auth/wrong-password":         "Incorrect password.",
    "auth/invalid-credential":     "Incorrect email or password.",
    "auth/email-already-in-use":   "An account with that email already exists.",
    "auth/invalid-email":          "Please enter a valid email address.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/popup-closed-by-user":   "Sign-in popup was closed.",
    "auth/network-request-failed": "Network error — check your connection.",
  })[code] || `Error: ${code}`;
}

tabSignIn.onclick = () => {
  tabSignIn.classList.add("active"); tabSignUp.classList.remove("active");
  passConfirmInput.style.display = "none";
  signInBtn.style.display = "block"; signUpBtn.style.display = "none";
  authErr("");
};
tabSignUp.onclick = () => {
  tabSignUp.classList.add("active"); tabSignIn.classList.remove("active");
  passConfirmInput.style.display = "block";
  signUpBtn.style.display = "block"; signInBtn.style.display = "none";
  authErr("");
};
signInBtn.onclick = async () => {
  authErr(""); setBusy(signInBtn, true);
  try { await signInWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value); }
  catch (e) { authErr(niceError(e.code)); }
  finally   { setBusy(signInBtn, false); }
};
signUpBtn.onclick = async () => {
  authErr("");
  if (passInput.value !== passConfirmInput.value) { authErr("Passwords don't match."); return; }
  setBusy(signUpBtn, true);
  try { await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value); }
  catch (e) { authErr(niceError(e.code)); }
  finally   { setBusy(signUpBtn, false); }
};
signOutBtn.onclick = () => { stopListening(); signOut(auth); };

onAuthStateChanged(auth, user => {
  if (user) {
    authScreen.style.display = "none";
    mainApp.style.display    = "block";
    userEmailEl.textContent  = user.displayName || user.email;
  } else {
    authScreen.style.display = "flex";
    mainApp.style.display    = "none";
    stopListening();
  }
});

// ── Sound definitions ─────────────────────────────────────────────────────────
// Each sound has:
//   tmIdx   — index in YOUR Teachable Machine model's softmax output
//             (0=Baby Crying, 1=Background Noise, 2=Car Horn, 3=Dog Barking,
//              4=Doorbell, 5=Fire Alarm, 6=Glass Breaking)
//   yamIdx  — YAMNet class indices that correspond to the same sound
//             (MAX across all indices is used as the YAMNet score)
//
// Alert logic (accuracy-first):
//   DANGER sounds  → alert if TM score alone is high (≥ tmDangerThreshold)
//                    OR if BOTH TM ≥ tmThreshold AND YAMNet ≥ yamThreshold
//                    (danger sounds must never be missed)
//   WARN/INFO sounds → alert only when BOTH models agree (ensemble voting)
//                      This eliminates almost all false positives.

const SOUNDS = [
  {
    id: "firealarm", tier: "danger", emoji: "🚨", label: "Fire Alarm",
    notif: "Fire alarm detected — check your surroundings!",
    tmIdx:  5,
    yamIdx: [388, 389, 390, 393, 396, 397],
    // 388=Smoke detector, 389=Fire alarm, 390=Alarm, 393=Buzzer,
    // 396=Siren, 397=Civil defense siren
  },
  {
    id: "glass", tier: "danger", emoji: "💥", label: "Glass Breaking",
    notif: "Glass breaking detected!",
    tmIdx:  6,
    yamIdx: [60, 61],
    // 60=Glass, 61=Shatter
  },
  {
    id: "baby", tier: "warn", emoji: "👶", label: "Baby Crying",
    notif: "Baby crying detected.",
    tmIdx:  0,
    yamIdx: [14, 15],
    // 14=Crying/sobbing, 15=Baby cry/infant cry
  },
  {
    id: "carhorn", tier: "warn", emoji: "📯", label: "Car Horn",
    notif: "Car horn detected nearby.",
    tmIdx:  2,
    yamIdx: [325, 326, 327],
    // 325=Car horn/honking, 326=Toot, 327=Truck horn
  },
  {
    id: "doorbell", tier: "info", emoji: "🔔", label: "Doorbell",
    notif: "Someone rang the doorbell.",
    tmIdx:  4,
    yamIdx: [379, 380],
    // 379=Doorbell, 380=Ding-dong
  },
  {
    id: "dog", tier: "info", emoji: "🐕", label: "Dog Barking",
    notif: "Dog barking detected.",
    tmIdx:  3,
    yamIdx: [74, 75, 76, 77],
    // 74=Dog, 75=Bark, 76=Yip, 77=Howl
  },
];

// TM model background noise class — if TM thinks it's this, skip inference
const TM_BACKGROUND_IDX = 1;

const enabled = Object.fromEntries(SOUNDS.map(s => [s.id, true]));

// ── Thresholds ────────────────────────────────────────────────────────────────
// These are tuned for accuracy-first operation.
// TM threshold: minimum TM score for a sound to be considered a candidate
// YAM threshold: minimum YAMNet score for ensemble confirmation
// Danger-only threshold: TM score so high we alert without YAMNet confirmation
//   (catches fire alarms even if YAMNet is uncertain — safety critical)

let TM_THRESHOLD     = 0.65;  // TM must be this confident (ensemble mode)
let YAM_THRESHOLD    = 0.10;  // YAMNet confirmation bar (lower — it's a coarse check)
let DANGER_TM_ONLY   = 0.90;  // TM alone triggers danger alert above this score
let THRESHOLD        = 0.65;  // exposed to the slider UI → updates TM_THRESHOLD

// ── App DOM ───────────────────────────────────────────────────────────────────
const statusEl        = document.getElementById("status");
const statusOrb       = document.getElementById("statusOrb");
const startBtn        = document.getElementById("startBtn");
const stopBtn         = document.getElementById("stopBtn");
const alertBox        = document.getElementById("alertBox");
const eventLog        = document.getElementById("eventLog");
const settingsBtn     = document.getElementById("settingsBtn");
const settingsPanel   = document.getElementById("settingsPanel");
const notifSetting    = document.getElementById("notifSetting");
const darkSetting     = document.getElementById("darkSetting");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdVal    = document.getElementById("thresholdVal");
const clearLogBtn     = document.getElementById("clearLog");

// ── Sound toggles ─────────────────────────────────────────────────────────────
(function buildToggles() {
  const container = document.getElementById("soundToggles");
  [["🚨 Emergency","danger"],["⚠️ Safety","warn"],["ℹ️ Everyday","info"]].forEach(([label, tier]) => {
    const hdr = document.createElement("div");
    hdr.className = "sound-group-label"; hdr.textContent = label;
    container.appendChild(hdr);
    SOUNDS.filter(s => s.tier === tier).forEach(s => {
      const row = document.createElement("div");
      row.className = "setting-row";
      row.innerHTML = `
        <div class="setting-label">${s.emoji} ${s.label}</div>
        <label class="toggle">
          <input type="checkbox" id="snd-${s.id}" checked>
          <span class="toggle-slider"></span>
        </label>`;
      container.appendChild(row);
      row.querySelector("input").onchange = e => { enabled[s.id] = e.target.checked; };
    });
  });
})();

// ── UI helpers ────────────────────────────────────────────────────────────────
function addLog(msg) {
  const ts = new Date().toLocaleTimeString();
  eventLog.textContent += `[${ts}] ${msg}\n`;
  eventLog.scrollTop = eventLog.scrollHeight;
}
clearLogBtn.onclick = () => { eventLog.textContent = ""; };
settingsBtn.onclick = () => {
  settingsPanel.style.display = settingsPanel.style.display === "block" ? "none" : "block";
};

const savedTheme = localStorage.getItem("audio-detector-theme") || "light";
document.body.classList.toggle("dark", savedTheme === "dark");
darkSetting.checked = savedTheme === "dark";
darkSetting.onchange = () => {
  document.body.classList.toggle("dark", darkSetting.checked);
  localStorage.setItem("audio-detector-theme", darkSetting.checked ? "dark" : "light");
};

// Slider controls the TM confidence threshold (the primary gatekeeper)
thresholdSlider.value = TM_THRESHOLD;
thresholdVal.textContent = TM_THRESHOLD.toFixed(2);
thresholdSlider.oninput = () => {
  THRESHOLD = TM_THRESHOLD = parseFloat(thresholdSlider.value);
  DANGER_TM_ONLY = Math.min(0.99, TM_THRESHOLD + 0.25);
  thresholdVal.textContent = TM_THRESHOLD.toFixed(2);
};

let alertTO;
function showAlert(sound, score, method) {
  clearTimeout(alertTO);
  const methodTag = method === "ensemble" ? "🤝 ensemble" : "⚡ fast-path";
  alertBox.className   = `alert-${sound.tier}`;
  alertBox.textContent = `${sound.emoji}  ${sound.label} detected (${score.toFixed(3)} · ${methodTag})`;
  alertBox.style.display   = "block";
  alertBox.style.animation = "none";
  void alertBox.offsetWidth;
  alertBox.style.animation = "";
  alertTO = setTimeout(() => { alertBox.style.display = "none"; }, 8000);
}

async function notify(sound) {
  if (!notifSetting.checked || !("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") {
    new Notification(`${sound.emoji} ${sound.label}`, { body: sound.notif });
  }
}

// Beep uses its own short-lived AudioContext so it never touches the mic context
function beep(tier) {
  try {
    const bCtx = new AudioContext();
    const o = bCtx.createOscillator();
    const g = bCtx.createGain();
    o.frequency.value = tier === "danger" ? 880 : tier === "warn" ? 660 : 440;
    o.type = tier === "danger" ? "square" : "sine";
    g.gain.setValueAtTime(0.0001, bCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08,   bCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, bCtx.currentTime + 0.35);
    o.connect(g); g.connect(bCtx.destination);
    o.start(); o.stop(bCtx.currentTime + 0.4);
    setTimeout(() => bCtx.close(), 1000);
  } catch (e) { console.error("Beep error:", e); }
}

async function saveSoundEvent(sound, score, method) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, "sound_events"), {
      userId: user.uid, soundLabel: sound.label,
      confidence: Number(score), detectedAt: serverTimestamp(),
      detectionMethod: method,
    });
  } catch (e) {
    console.error("Failed to save sound event:", e);
    addLog(`Cloud save failed: ${e?.message || "unknown error"}`);
  }
}

// ── Model constants ───────────────────────────────────────────────────────────
// TM model (your trained model.json / weights.bin)
const TM_MODEL_URL   = "./model.json";
const TM_NUM_FRAMES  = 43;
const TM_NUM_BINS    = 232;
const TM_FFT_SIZE    = 1024;
const TM_FRAME_MS    = 23;   // ≈ 1024 / 44100 * 1000
const TM_INFER_MS    = 500;  // run TM inference every 500 ms

// YAMNet (Google TF Hub)
const YAM_MODEL_URL  = "https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1";
const YAM_SR         = 16000;
const YAM_WINDOW_S   = 1.5;
const YAM_CAPTURE_MS = 46;   // ≈ 2048 / 44100 * 1000
const YAM_INFER_MS   = 750;  // YAMNet runs less often (heavier model)

const COOLDOWN = 3000;   // ms between alerts per sound

// ── State ─────────────────────────────────────────────────────────────────────
let tmModel    = null;
let yamModel   = null;
let audioCtx   = null;
let micStream  = null;
let srcNode    = null;
let nativeSR   = 44100;

// TM uses AnalyserNode at FFT_SIZE 1024 → frequencyBinCount = 512
// We slice to first 232 bins, matching TM training exactly
let tmAnalyser   = null;
let tmFrameBuf   = [];     // rolling array of Float32Array[232]
let tmFrameTimer = null;
let tmInferTimer = null;

// YAMNet uses a separate AnalyserNode for raw PCM + ring buffer
let yamAnalyser  = null;
let yamRing      = null;   // Float32Array ring buffer
let yamRingHead  = 0;
let yamRingFull  = false;
let yamCapTimer  = null;
let yamInferTimer = null;

let silentGain = null;
let listening  = false;
let lastHit    = {};  // { soundId: timestamp } — per-sound cooldown

// Latest scores from each model, updated independently
let latestTmScores  = null;  // Float32Array[7]
let latestYamScores = null;  // Float32Array[521]

// ── Model loading ─────────────────────────────────────────────────────────────
async function loadModels() {
  statusEl.textContent = "Loading models…";

  // Load both models in parallel for faster startup
  addLog("Loading TM model and YAMNet in parallel…");
  const [tm, yam] = await Promise.all([
    window.tf.loadLayersModel(TM_MODEL_URL).catch(e => {
      addLog("⚠️ TM model failed to load: " + e.message); return null;
    }),
    window.tf.loadGraphModel(YAM_MODEL_URL, { fromTFHub: true }).catch(e => {
      addLog("⚠️ YAMNet failed to load: " + e.message); return null;
    }),
  ]);

  tmModel  = tm;
  yamModel = yam;

  if (!tmModel && !yamModel) {
    statusEl.textContent = "Both models failed to load";
    throw new Error("No models available");
  }

  // Warm up whichever loaded
  if (tmModel) {
    const d = window.tf.zeros([1, TM_NUM_FRAMES, TM_NUM_BINS, 1]);
    tmModel.predict(d).dispose(); d.dispose();
    addLog("✅ TM model ready (7 classes).");
  }
  if (yamModel) {
    const d = window.tf.zeros([YAM_SR]);
    const out = yamModel.execute({ waveform: d });
    (Array.isArray(out) ? out : [out]).forEach(t => t.dispose()); d.dispose();
    addLog("✅ YAMNet ready (521 classes).");
  }

  if (tmModel && yamModel) {
    addLog("🤝 Ensemble mode: both models must agree before alerting.");
  } else if (tmModel) {
    addLog("⚠️ Running TM-only mode (YAMNet unavailable).");
  } else {
    addLog("⚠️ Running YAMNet-only mode (TM unavailable).");
  }

  statusEl.textContent = "Ready";
}

// ── TM frame collection ───────────────────────────────────────────────────────
// Captures frequency-domain data (dB) exactly as TM does during training.
function collectTmFrame() {
  if (!tmAnalyser) return;
  const freqData = new Float32Array(tmAnalyser.frequencyBinCount); // 512 bins
  tmAnalyser.getFloatFrequencyData(freqData);
  tmFrameBuf.push(freqData.slice(0, TM_NUM_BINS));  // keep first 232 bins
  // Keep a rolling window — only need the last TM_NUM_FRAMES frames
  if (tmFrameBuf.length > TM_NUM_FRAMES * 2) {
    tmFrameBuf = tmFrameBuf.slice(-TM_NUM_FRAMES);
  }
}

// ── TM inference ──────────────────────────────────────────────────────────────
async function runTmInference() {
  if (!tmModel || !listening || tmFrameBuf.length < TM_NUM_FRAMES) return;

  const frames = tmFrameBuf.slice(-TM_NUM_FRAMES);
  const flat   = new Float32Array(TM_NUM_FRAMES * TM_NUM_BINS);
  for (let i = 0; i < TM_NUM_FRAMES; i++) flat.set(frames[i], i * TM_NUM_BINS);

  // Z-score normalization — required to match TM's training pipeline
  let sum = 0;
  for (let i = 0; i < flat.length; i++) sum += flat[i];
  const mean = sum / flat.length;
  let sqSum  = 0;
  for (let i = 0; i < flat.length; i++) sqSum += (flat[i] - mean) ** 2;
  const std = Math.sqrt(sqSum / flat.length) || 1;
  for (let i = 0; i < flat.length; i++) flat[i] = (flat[i] - mean) / std;

  let input, prediction;
  try {
    input      = window.tf.tensor4d(flat, [1, TM_NUM_FRAMES, TM_NUM_BINS, 1]);
    prediction = tmModel.predict(input);
    latestTmScores = (await prediction.array())[0];
  } catch (e) {
    addLog("⚠️ TM inference error: " + e.message); return;
  } finally {
    input?.dispose(); prediction?.dispose();
  }

  // Log top-3 TM scores for debugging
  const top3 = latestTmScores.map((v, i) => [i, v])
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log("TM top-3:", top3.map(([i, v]) => `[${i}]${v.toFixed(3)}`).join(" "));

  // Attempt to fire an alert now that TM has new scores
  evaluateEnsemble("tm");
}

// ── YAMNet frame collection ───────────────────────────────────────────────────
// Captures raw PCM via time-domain data — what YAMNet needs after resampling.
function collectYamFrame() {
  if (!yamAnalyser) return;
  const chunk = new Float32Array(yamAnalyser.fftSize); // 2048 raw PCM samples
  yamAnalyser.getFloatTimeDomainData(chunk);
  for (let i = 0; i < chunk.length; i++) {
    yamRing[yamRingHead] = chunk[i];
    yamRingHead = (yamRingHead + 1) % yamRing.length;
    if (yamRingHead === 0) yamRingFull = true;
  }
}

function readYamRing() {
  if (!yamRingFull) return yamRing.slice(0, yamRingHead);
  const out = new Float32Array(yamRing.length);
  out.set(yamRing.subarray(yamRingHead));
  out.set(yamRing.subarray(0, yamRingHead), yamRing.length - yamRingHead);
  return out;
}

async function resampleTo16k(float32, fromSR) {
  if (fromSR === YAM_SR) return float32;
  const outLen = Math.ceil(float32.length * YAM_SR / fromSR);
  const offCtx = new OfflineAudioContext(1, outLen, YAM_SR);
  const buf    = offCtx.createBuffer(1, float32.length, fromSR);
  buf.getChannelData(0).set(float32);
  const src = offCtx.createBufferSource();
  src.buffer = buf; src.connect(offCtx.destination); src.start(0);
  const rendered = await offCtx.startRendering();
  return rendered.getChannelData(0);
}

// ── YAMNet inference ──────────────────────────────────────────────────────────
async function runYamInference() {
  if (!yamModel || !listening) return;
  const needed = Math.ceil(nativeSR * YAM_WINDOW_S);
  if (!yamRingFull && yamRingHead < needed) return;

  const all  = readYamRing();
  const snap = all.length >= needed ? all.slice(all.length - needed) : all;

  let wv, outTensors;
  try {
    const s16     = await resampleTo16k(snap, nativeSR);
    const clamped = s16.map(v => Math.max(-1, Math.min(1, v)));
    wv = window.tf.tensor1d(clamped);
    outTensors = yamModel.execute({ waveform: wv });
    const scoresTensor = Array.isArray(outTensors) ? outTensors[0] : outTensors;
    const meanScores   = window.tf.mean(scoresTensor, 0);
    latestYamScores    = await meanScores.array();
    meanScores.dispose();
  } catch (e) {
    addLog("⚠️ YAMNet inference error: " + e.message); return;
  } finally {
    wv?.dispose();
    (Array.isArray(outTensors) ? outTensors : [outTensors]).forEach(t => t?.dispose());
  }

  // Log top-5 YAMNet for debugging
  const top5 = latestYamScores.map((v, i) => [i, v])
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log("YAMNet top-5:", top5.map(([i, v]) => `[${i}]${v.toFixed(3)}`).join(" "));

  evaluateEnsemble("yam");
}

// ── Ensemble evaluation ───────────────────────────────────────────────────────
// Called after either model updates its scores. Checks all enabled sounds
// and decides whether to fire an alert based on the ensemble voting logic.
//
// Strategy (accuracy-first):
//   1. If only one model is loaded, use it alone with a high threshold.
//   2. If both models are loaded:
//        a. DANGER sounds: alert if TM score ≥ DANGER_TM_ONLY  (safety net,
//           skips YAMNet confirmation — we can't miss a fire alarm)
//        b. All sounds: alert if TM ≥ TM_THRESHOLD AND YAMNet ≥ YAM_THRESHOLD
//           (ensemble agreement — very low false positive rate)

function evaluateEnsemble(trigger) {
  if (!listening) return;
  const now  = Date.now();
  const both = tmModel && yamModel;

  let best = null, bestScore = 0, bestMethod = "";

  for (const s of SOUNDS) {
    if (!enabled[s.id]) continue;
    if (now - (lastHit[s.id] ?? 0) < COOLDOWN) continue;

    const tmScore  = latestTmScores  ? (latestTmScores[s.tmIdx]  ?? 0) : 0;
    const yamScore = latestYamScores
      ? Math.max(...s.yamIdx.map(i => latestYamScores[i] ?? 0))
      : 0;

    // Skip if TM thinks this is background noise dominating the window
    if (latestTmScores && latestTmScores[TM_BACKGROUND_IDX] > tmScore) continue;

    let score  = 0;
    let method = "";

    if (!both) {
      // Single-model fallback
      if (tmModel  && tmScore  >= TM_THRESHOLD)  { score = tmScore;  method = "tm-only";  }
      if (yamModel && yamScore >= 0.20)           { score = yamScore; method = "yam-only"; }
    } else {
      // Ensemble path
      // 2a: Danger fast-path — TM alone if extremely confident
      if (s.tier === "danger" && tmScore >= DANGER_TM_ONLY) {
        score  = tmScore;
        method = "fast-path";
      }
      // 2b: Full ensemble agreement
      else if (tmScore >= TM_THRESHOLD && yamScore >= YAM_THRESHOLD) {
        // Combined score: weighted average (TM carries more weight as it's
        // specifically trained on these exact sound classes)
        score  = tmScore * 0.7 + yamScore * 0.3;
        method = "ensemble";
      }
    }

    if (score > 0 && score > bestScore) {
      best = s; bestScore = score; bestMethod = method;
    }
  }

  if (best) {
    lastHit[best.id] = now;
    showAlert(best, bestScore, bestMethod);
    addLog(`${best.emoji} ${best.label} — score ${bestScore.toFixed(3)} [${bestMethod}]`);
    beep(best.tier);
    notify(best);
    sendEmail(best, bestScore);
    saveSoundEvent(best, bestScore, bestMethod);
    flashScreen(3);
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────
async function startListening() {
  if (!tmModel && !yamModel) await loadModels();
  if (listening) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, // keep raw audio — processing hurts accuracy
        noiseSuppression: false,
        autoGainControl:  false,
        channelCount:     1,
      },
      video: false,
    });
  } catch (e) {
    addLog("Mic error: " + e.message);
    statusEl.textContent = "Mic denied"; return;
  }

  try {
    micStream = stream;
    audioCtx  = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    nativeSR  = audioCtx.sampleRate;

    srcNode = audioCtx.createMediaStreamSource(stream);

    // ── TM analyser: frequency domain, FFT 1024 ───────────────────────────
    if (tmModel) {
      tmAnalyser = audioCtx.createAnalyser();
      tmAnalyser.fftSize               = TM_FFT_SIZE; // 1024 → 512 bins
      tmAnalyser.smoothingTimeConstant = 0;
      srcNode.connect(tmAnalyser);
    }

    // ── YAMNet analyser: time domain (raw PCM), FFT 2048 ─────────────────
    if (yamModel) {
      yamAnalyser = audioCtx.createAnalyser();
      yamAnalyser.fftSize               = 2048;
      yamAnalyser.smoothingTimeConstant = 0;
      srcNode.connect(yamAnalyser);

      yamRing     = new Float32Array(nativeSR * 6); // 6 s ring buffer
      yamRingHead = 0;
      yamRingFull = false;
    }

    // Silent gain keeps the graph alive without playing mic audio to speakers
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    if (tmAnalyser)  tmAnalyser.connect(silentGain);
    if (yamAnalyser) yamAnalyser.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    tmFrameBuf = [];
    lastHit    = {};
    latestTmScores  = null;
    latestYamScores = null;
    listening  = true;

    // Start timers for each model
    if (tmModel) {
      tmFrameTimer = setInterval(collectTmFrame, TM_FRAME_MS);
      tmInferTimer = setInterval(runTmInference, TM_INFER_MS);
    }
    if (yamModel) {
      yamCapTimer   = setInterval(collectYamFrame,  YAM_CAPTURE_MS);
      yamInferTimer = setInterval(runYamInference,  YAM_INFER_MS);
    }

    startBtn.disabled = true;
    stopBtn.disabled  = false;
    statusEl.textContent = "Listening…";
    statusOrb.classList.add("listening");
    addLog(`🎤 Mic active at ${nativeSR} Hz.`);
  } catch (e) {
    console.error("Audio setup error:", e);
    addLog("Audio system error: " + e.message);
    statusEl.textContent = "Audio error";
    stopListening();
  }
}

function stopListening() {
  clearInterval(tmFrameTimer); clearInterval(tmInferTimer);
  clearInterval(yamCapTimer);  clearInterval(yamInferTimer);
  tmFrameTimer = tmInferTimer = yamCapTimer = yamInferTimer = null;

  try { srcNode?.disconnect();     } catch {}
  try { tmAnalyser?.disconnect();  } catch {}
  try { yamAnalyser?.disconnect(); } catch {}
  try { silentGain?.disconnect();  } catch {}
  try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
  try { if (audioCtx?.state !== "closed") audioCtx?.close(); } catch {}

  srcNode = tmAnalyser = yamAnalyser = silentGain = micStream = audioCtx = null;
  yamRing = null; yamRingHead = 0; yamRingFull = false;
  tmFrameBuf = []; latestTmScores = null; latestYamScores = null;
  listening  = false;

  if (startBtn)  startBtn.disabled  = false;
  if (stopBtn)   stopBtn.disabled   = true;
  if (statusEl)  statusEl.textContent  = "Stopped";
  if (statusOrb) statusOrb.classList.remove("listening");
  addLog("⏹ Stopped.");
}

startBtn.onclick = startListening;
stopBtn.onclick  = stopListening;

async function flashScreen(times = 3) {
  const overlay = document.getElementById("flashOverlay");
  if (!overlay) return;
  for (let i = 0; i < times; i++) {
    overlay.style.opacity = "1";
    await new Promise(r => setTimeout(r, 100));
    overlay.style.opacity = "0";
    await new Promise(r => setTimeout(r, 150));
  }
}
