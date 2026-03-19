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
const EMAILJS_SERVICE_ID = "TSA-Sound-Detector";
const EMAILJS_TEMPLATE_ID = "template_fa9wwjj";

async function sendEmail(sound, score) {
  const emailSetting = document.getElementById("emailSetting");
  const emailAddressInput = document.getElementById("emailAddress");

  if (!emailSetting || !emailSetting.checked) return;

  const toEmail = emailAddressInput?.value.trim();
  if (!toEmail) {
    addLog("📧 Email failed: no email address entered.");
    return;
  }

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      email: toEmail,
      sound: sound.label,
      emoji: sound.emoji,
      score: score.toFixed(3),
      time: new Date().toLocaleString(),
    });

    addLog(`📧 Email sent for ${sound.label} to ${toEmail}`);
  } catch (e) {
    console.error("EmailJS send failed:", e);
    addLog(`📧 Email failed: ${e?.text || e?.message || "unknown error"}`);
  }
}

// ── Auth DOM ──────────────────────────────────────────────────────────────────
const authScreen = document.getElementById("authScreen");
const mainApp = document.getElementById("mainApp");
const authErrorEl = document.getElementById("authError");
const userEmailEl = document.getElementById("userEmail");
const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const passConfirmInput = document.getElementById("passConfirmInput");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const signOutBtn = document.getElementById("signOutBtn");

// ── Auth helpers ──────────────────────────────────────────────────────────────
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
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in popup was closed.",
    "auth/network-request-failed": "Network error — check your connection.",
  })[code] || `Error: ${code}`;
}

// ── Auth tab switch ───────────────────────────────────────────────────────────
tabSignIn.onclick = () => {
  tabSignIn.classList.add("active");
  tabSignUp.classList.remove("active");
  passConfirmInput.style.display = "none";
  signInBtn.style.display = "block";
  signUpBtn.style.display = "none";
  authErr("");
};

tabSignUp.onclick = () => {
  tabSignUp.classList.add("active");
  tabSignIn.classList.remove("active");
  passConfirmInput.style.display = "block";
  signUpBtn.style.display = "block";
  signInBtn.style.display = "none";
  authErr("");
};

signInBtn.onclick = async () => {
  authErr("");
  setBusy(signInBtn, true);
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value);
  } catch (e) {
    authErr(niceError(e.code));
  } finally {
    setBusy(signInBtn, false);
  }
};

signUpBtn.onclick = async () => {
  authErr("");
  if (passInput.value !== passConfirmInput.value) {
    authErr("Passwords don't match.");
    return;
  }
  setBusy(signUpBtn, true);
  try {
    await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value);
  } catch (e) {
    authErr(niceError(e.code));
  } finally {
    setBusy(signUpBtn, false);
  }
};

signOutBtn.onclick = () => {
  stopListening();
  signOut(auth);
};

onAuthStateChanged(auth, user => {
  if (user) {
    authScreen.style.display = "none";
    mainApp.style.display = "block";
    userEmailEl.textContent = user.displayName || user.email;
  } else {
    authScreen.style.display = "flex";
    mainApp.style.display = "none";
    stopListening();
  }
});

// ── Sounds ────────────────────────────────────────────────────────────────────
// Teachable Machine model classes (from SoundRecognition (1)/metadata.json):
// 0: Baby Crying, 1: Background Noise, 2: Car Horn, 3: Dog Barking,
// 4: Doorbell, 5: Fire Alarm, 6: Glass Breaking
const SOUNDS = [
  { id: "firealarm", idx: 5, label: "Fire Alarm", emoji: "🚨", tier: "danger", notif: "Fire alarm detected!" },
  { id: "glass", idx: 6, label: "Glass Breaking", emoji: "💥", tier: "danger", notif: "Glass breaking detected!" },
  { id: "baby", idx: 0, label: "Baby Crying", emoji: "👶", tier: "warn", notif: "Baby crying detected." },
  { id: "carhorn", idx: 2, label: "Car Horn", emoji: "📯", tier: "warn", notif: "Car horn detected." },
  { id: "doorbell", idx: 4, label: "Doorbell", emoji: "🔔", tier: "info", notif: "Someone rang the doorbell." },
  { id: "dog", idx: 3, label: "Dog Barking", emoji: "🐕", tier: "info", notif: "Dog barking detected." },
];

const enabled = Object.fromEntries(SOUNDS.map(s => [s.id, true]));

// ── App DOM ───────────────────────────────────────────────────────────────────
const statusEl = document.getElementById("status");
const statusOrb = document.getElementById("statusOrb");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const alertBox = document.getElementById("alertBox");
const eventLog = document.getElementById("eventLog");
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const notifSetting = document.getElementById("notifSetting");
const darkSetting = document.getElementById("darkSetting");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdVal = document.getElementById("thresholdVal");
const clearLogBtn = document.getElementById("clearLog");

// ── Sound toggles ─────────────────────────────────────────────────────────────
(function buildToggles() {
  const container = document.getElementById("soundToggles");

  [
    ["🚨 Emergency", "danger"],
    ["⚠️ Safety", "warn"],
    ["ℹ️ Everyday", "info"]
  ].forEach(([label, tier]) => {
    const hdr = document.createElement("div");
    hdr.className = "sound-group-label";
    hdr.textContent = label;
    container.appendChild(hdr);

    SOUNDS.filter(s => s.tier === tier).forEach(s => {
      const row = document.createElement("div");
      row.className = "setting-row";
      row.innerHTML = `
        <div class="setting-label">${s.emoji} ${s.label}</div>
        <label class="toggle">
          <input type="checkbox" id="snd-${s.id}" checked>
          <span class="toggle-slider"></span>
        </label>
      `;
      container.appendChild(row);

      row.querySelector("input").onchange = e => {
        enabled[s.id] = e.target.checked;
      };
    });
  });
})();

// ── UI helpers ────────────────────────────────────────────────────────────────
function addLog(msg) {
  const ts = new Date().toLocaleTimeString();
  eventLog.textContent += `[${ts}] ${msg}\n`;
  eventLog.scrollTop = eventLog.scrollHeight;
}

clearLogBtn.onclick = () => {
  eventLog.textContent = "";
};

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

thresholdSlider.oninput = () => {
  THRESHOLD = parseFloat(thresholdSlider.value);
  thresholdVal.textContent = THRESHOLD.toFixed(2);
};

let alertTO;

function showAlert(sound, score) {
  clearTimeout(alertTO);
  alertBox.className = `alert-${sound.tier}`;
  alertBox.textContent = `${sound.emoji}  ${sound.label} detected (${score.toFixed(3)})`;
  alertBox.style.display = "block";
  alertBox.style.animation = "none";
  void alertBox.offsetWidth;
  alertBox.style.animation = "";
  alertTO = setTimeout(() => {
    alertBox.style.display = "none";
  }, 8000);
}

async function notify(sound) {
  if (!notifSetting.checked || !("Notification" in window)) return;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    new Notification(`${sound.emoji} ${sound.label}`, {
      body: sound.notif
    });
  }
}

function beep(tier) {
  try {
    if (!audioCtx || audioCtx.state === "closed") return;

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.frequency.value = tier === "danger" ? 880 : tier === "warn" ? 660 : 440;
    o.type = tier === "danger" ? "square" : "sine";

    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start();
    o.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.error("Beep error:", e);
  }
}

async function saveSoundEvent(sound, score) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await addDoc(collection(db, "sound_events"), {
      userId: user.uid,
      soundLabel: sound.label,
      confidence: Number(score),
      detectedAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Failed to save sound event:", e);
    addLog(`Cloud save failed: ${e?.message || "unknown error"}`);
  }
}

// ── Teachable Machine Model ──────────────────────────────────────────────────
const MODEL_PATH = "./model.json";
const NUM_FRAMES = 43;
const FFT_SIZE = 1024;
const NUM_FREQ_BINS = 232;
const FRAME_HOP_MS = 23;          // ~1024 / 44100 ≈ 23 ms per frame
const INFERENCE_INTERVAL_MS = 1000;
const COOLDOWN = 3000;
const BACKGROUND_NOISE_IDX = 1;   // index 1 in the TM model
let THRESHOLD = 0.20;

let model = null;
let audioCtx = null;
let analyser = null;
let micStream = null;
let srcNode = null;
let silentGain = null;
let frameBuffer = [];
let frameTimer = null;
let inferenceTimer = null;
let listening = false;
let lastHit = 0;

async function loadModel() {
  statusEl.textContent = "Loading model…";
  addLog("Loading Teachable Machine sound model…");
  model = await window.tf.loadLayersModel(MODEL_PATH);
  addLog("Model loaded — 6 sound classes active.");
  statusEl.textContent = "Ready";
}

function collectFrame() {
  if (!analyser) return;
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  frameBuffer.push(freqData.slice(0, NUM_FREQ_BINS));
  if (frameBuffer.length > NUM_FRAMES * 2) {
    frameBuffer = frameBuffer.slice(-NUM_FRAMES);
  }
}

async function runInference() {
  if (!model || !listening || frameBuffer.length < NUM_FRAMES) return;

  const now = Date.now();
  if (now - lastHit <= COOLDOWN) return;

  const frames = frameBuffer.slice(-NUM_FRAMES);
  const flat = new Float32Array(NUM_FRAMES * NUM_FREQ_BINS);
  for (let i = 0; i < NUM_FRAMES; i++) {
    flat.set(frames[i], i * NUM_FREQ_BINS);
  }

  // Z-score normalize (same as @tensorflow-models/speech-commands)
  let sum = 0;
  for (let i = 0; i < flat.length; i++) sum += flat[i];
  const mean = sum / flat.length;
  let sqSum = 0;
  for (let i = 0; i < flat.length; i++) sqSum += (flat[i] - mean) ** 2;
  const std = Math.sqrt(sqSum / flat.length) || 1;
  for (let i = 0; i < flat.length; i++) flat[i] = (flat[i] - mean) / std;

  let input, prediction, arr;
  try {
    input = window.tf.tensor4d(flat, [1, NUM_FRAMES, NUM_FREQ_BINS, 1]);
    prediction = model.predict(input);
    arr = (await prediction.array())[0];
  } catch (e) {
    addLog("Inference error: " + e.message);
    return;
  } finally {
    input?.dispose();
    prediction?.dispose();
  }

  const top = arr.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log("Top-3:", top.map(([i, v]) => `[${i}] ${v.toFixed(3)}`).join("  "));

  // Skip if background noise is the dominant class
  if (top[0][0] === BACKGROUND_NOISE_IDX) return;

  let best = null;
  let bestScore = 0;

  for (const s of SOUNDS) {
    if (!enabled[s.id]) continue;
    const sc = arr[s.idx];
    if (sc >= THRESHOLD && sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }

  if (best) {
    lastHit = now;
    showAlert(best, bestScore);
    addLog(`${best.emoji} ${best.label} — score ${bestScore.toFixed(3)}`);
    beep(best.tier);
    notify(best);
    await sendEmail(best, bestScore);
    await saveSoundEvent(best, bestScore);
    await flashScreen(3);
  }
}

async function startListening() {
  if (!model) await loadModel();
  if (listening) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });
  } catch (e) {
    addLog("Mic error: " + e.message);
    statusEl.textContent = "Mic denied";
    return;
  }

  try {
    micStream = stream;
    audioCtx = new AudioContext();

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    srcNode = audioCtx.createMediaStreamSource(stream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;

    // Connect through a silent gain so the audio graph stays alive
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    srcNode.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    frameBuffer = [];
    listening = true;

    frameTimer = setInterval(collectFrame, FRAME_HOP_MS);
    inferenceTimer = setInterval(runInference, INFERENCE_INTERVAL_MS);

    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Listening…";
    statusOrb.classList.add("listening");
    addLog("Mic active — collecting audio frames.");
  } catch (e) {
    console.error("AudioContext/startListening error:", e);
    addLog("Audio system error: " + e.message);
    statusEl.textContent = "Audio error";
    stopListening();
  }
}

function stopListening() {
  clearInterval(frameTimer);
  clearInterval(inferenceTimer);
  frameTimer = null;
  inferenceTimer = null;

  try { srcNode?.disconnect(); } catch {}
  try { analyser?.disconnect(); } catch {}
  try { silentGain?.disconnect(); } catch {}

  try {
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
    }
  } catch {}

  try {
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close();
    }
  } catch {}

  srcNode = null;
  analyser = null;
  silentGain = null;
  micStream = null;
  audioCtx = null;
  frameBuffer = [];
  listening = false;

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (statusEl) statusEl.textContent = "Stopped";
  if (statusOrb) statusOrb.classList.remove("listening");

  addLog("Stopped.");
}

startBtn.onclick = startListening;
stopBtn.onclick = stopListening;

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
