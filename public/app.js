"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const pip = $("#pip");
const mouth = $("#mouth");
const said = $("#said");
const asked = $("#asked");
const talkBtn = $("#talk");
const typeForm = $("#type-form");
const typeInput = $("#type-input");
const muteBtn = $("#mute");

const GREETINGS = {
  ask: "Hi, I'm Pip! What are you curious about today? Ask me anything.",
  quiz: "Quiz time! Pick a topic, like dinosaurs, space or the human body, and I'll ask you questions.",
  think: "Got a tricky problem? Tell me about it, and we'll work it out together, step by step.",
  portuguese: "«Olá!» That means hello. Let's learn some Portuguese together. What would you like to learn to say?",
};

const OOPS_LINE = "Hmm, my brain got a little tangled. Can you ask me that in a different way?";
const MOUTHS = {
  idle: "M128 194 Q150 214 172 194",
  open: "M132 190 Q150 226 168 190 Q150 197 132 190 Z",
  half: "M134 192 Q150 210 166 192 Q150 197 134 192 Z",
  happy: "M120 186 Q150 232 180 186 Q150 198 120 186 Z",
  oops: "M128 202 Q139 192 150 202 Q161 212 172 202",
  thinking: "M144 200 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0",
  listening: "M138 194 Q150 210 162 194 Q150 199 138 194 Z",
};

// ---------- persisted preferences (best effort) ----------

const store = {
  get(key, fallback) {
    try { return localStorage.getItem("pip." + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("pip." + key, value); } catch { /* private mode */ }
  },
};

const state = {
  mode: store.get("mode", "ask"),
  age: store.get("age", "8-10"),
  muted: store.get("muted", "0") === "1",
  speakLang: "en-US",
  history: [],
  controller: null,
  busy: false,
  interacted: false,
};
if (!GREETINGS[state.mode]) state.mode = "ask";
if (!["5-7", "8-10", "11-13"].includes(state.age)) state.age = "8-10";

// ---------- Pip's face ----------

let mood = "idle";
let flapTimer = null;

function setMood(next) {
  mood = next;
  pip.dataset.mood = next;
  clearInterval(flapTimer);
  flapTimer = null;
  if (next === "talking") {
    let open = false;
    flapTimer = setInterval(() => {
      open = !open;
      mouth.setAttribute("d", open ? (Math.random() < 0.4 ? MOUTHS.half : MOUTHS.open) : MOUTHS.idle);
      mouth.setAttribute("fill", open ? "#7a1f3d" : "none");
    }, 120 + Math.random() * 60);
    return;
  }
  const shape = MOUTHS[next] ?? MOUTHS.idle;
  mouth.setAttribute("d", shape);
  mouth.setAttribute("fill", /Z$|a7/.test(shape) ? (next === "thinking" ? "#14193a" : "#7a1f3d") : "none");
}

const pupils = $$(".pupil");
let lastPointer = 0;

function look(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, len / 260) * 11;
  const x = (dx / len) * reach;
  const y = (dy / len) * reach;
  pupils.forEach((p) => p.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`));
}

window.addEventListener("pointermove", (e) => {
  lastPointer = Date.now();
  if (mood === "thinking") return;
  const r = pip.getBoundingClientRect();
  look(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height * 0.47));
});

setInterval(() => {
  if (mood === "thinking") return look(120, -200);
  if (Date.now() - lastPointer < 3000) return;
  const glances = [[0, 0], [-200, 20], [200, 10], [0, 160], [0, 0]];
  const [x, y] = glances[Math.floor(Math.random() * glances.length)];
  look(x, y);
}, 1800);

(function blinkLoop() {
  const eyes = $$(".eye");
  setTimeout(() => {
    eyes.forEach((e) => e.classList.add("shut"));
    setTimeout(() => {
      eyes.forEach((e) => e.classList.remove("shut"));
      blinkLoop();
    }, 120);
  }, 2200 + Math.random() * 3200);
})();

// ---------- speech bubble ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function showSaid(text) {
  const clean = text.replace(/\[\[(yay|oops)\]\]/g, "").replace(/\[\[?[a-z]*$/, "").trimStart();
  said.innerHTML = escapeHtml(clean).replace(/«([^»]*)»?/g, '<span class="pt">$1</span>');
  said.scrollTop = said.scrollHeight;
}

function showAsked(text) {
  asked.hidden = !text;
  asked.textContent = text || "";
}

// ---------- voice out ----------

let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
loadVoices();
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;

const PREFERRED = {
  en: ["Samantha", "Google US English", "Karen", "Moira", "Serena", "Microsoft Aria", "Microsoft Jenny"],
  pt: ["Joana", "Catarina", "Google português de Portugal", "Microsoft Raquel", "Luciana"],
};

function pickVoice(lang) {
  const base = lang.slice(0, 2);
  const pool = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(base));
  if (!pool.length) return null;
  const exact = pool.filter((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
  const ranked = exact.length ? exact : pool;
  return (
    ranked.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ||
    PREFERRED[base].map((n) => ranked.find((v) => v.name.startsWith(n))).find(Boolean) ||
    ranked.find((v) => v.localService) ||
    ranked[0]
  );
}

// Keeps utterances referenced so Chrome doesn't garbage-collect them mid-sentence.
const speaking = new Set();
let streamDone = true;
let afterSpeech = null;

// Speech events are unreliable across browsers (Chrome sometimes never fires onstart/onend),
// so Pip's face follows a poll of speechSynthesis plus a deadline based on how much was queued.
let speechDeadline = 0;
let speechPoll = null;

function watchSpeech() {
  if (speechPoll) return;
  speechPoll = setInterval(() => {
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    if (busy && Date.now() < speechDeadline) return;
    if (busy) speechSynthesis.cancel();
    clearInterval(speechPoll);
    speechPoll = null;
    speaking.clear();
    maybeFinished();
  }, 200);
}

function speak(text) {
  const clean = text.replace(/\[\[(yay|oops)\]\]/g, "").trim();
  if (!clean || state.muted || !window.speechSynthesis) return;
  const parts = clean.split(/«([^»]*)»/);
  parts.forEach((part, i) => {
    const words = part.replace(/[«»]/g, "").trim();
    if (!words || !/[\p{L}\p{N}]/u.test(words)) return;
    const pt = i % 2 === 1;
    const u = new SpeechSynthesisUtterance(words);
    u.lang = pt ? "pt-PT" : "en-US";
    const voice = pickVoice(u.lang);
    if (voice) u.voice = voice;
    u.rate = pt ? 0.88 : 1.0;
    u.pitch = 1.25;
    u.onend = u.onerror = () => {
      speaking.delete(u);
      maybeFinished();
    };
    speaking.add(u);
    speechSynthesis.speak(u);
    const seconds = words.split(/\s+/).length * (pt ? 0.6 : 0.45) + 2;
    speechDeadline = Math.max(speechDeadline, Date.now()) + seconds * 1000;
  });
  if (speaking.size) {
    if (mood !== "happy") setMood("talking");
    watchSpeech();
  }
}

function maybeFinished() {
  if (!streamDone || speaking.size) return;
  const next = afterSpeech ?? "idle";
  afterSpeech = null;
  if (mood !== "happy" && mood !== "listening") setMood(next);
}

function stopVoice() {
  speaking.clear();
  speechDeadline = 0;
  clearInterval(speechPoll);
  speechPoll = null;
  if (window.speechSynthesis) speechSynthesis.cancel();
}

// Splits streamed text into speakable sentences, never inside a «Portuguese» span.
function takeSentences(buffer, final) {
  if (final) return { ready: buffer, rest: "" };
  let cut = -1;
  let depth = 0;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c === "«") depth++;
    else if (c === "»") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[.!?…]/.test(c) && /\s/.test(buffer[i + 1] ?? "")) cut = i + 1;
  }
  if (cut === -1) return { ready: "", rest: buffer };
  return { ready: buffer.slice(0, cut), rest: buffer.slice(cut) };
}

// ---------- confetti ----------

function confetti() {
  const box = $("#confetti");
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ff6b9a", "#8b5cf6", "#06b6d4"];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = 1.8 + Math.random() * 1.8 + "s";
    p.style.animationDelay = Math.random() * 0.4 + "s";
    p.style.setProperty("--dx", Math.random() * 200 - 100 + "px");
    p.style.setProperty("--rot", Math.random() * 900 - 450 + "deg");
    box.appendChild(p);
  }
  setTimeout(() => (box.innerHTML = ""), 4500);
}

// ---------- talking to the server ----------

function stopEverything() {
  state.controller?.abort();
  state.controller = null;
  stopVoice();
  streamDone = true;
}

async function ask(question) {
  question = question.trim().slice(0, 600);
  if (!question) return;
  stopEverything();

  state.history.push({ role: "user", content: question });
  showAsked(question);
  showSaid("");
  setMood("thinking");
  state.busy = true;
  streamDone = false;
  afterSpeech = null;

  const controller = new AbortController();
  state.controller = controller;
  let full = "";
  let pending = "";
  let cheered = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: state.mode, age: state.age, messages: state.history }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error("busy");
    if (!res.ok || !res.body) throw new Error("http " + res.status);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      full += value;
      pending += value;
      if (!cheered && full.includes("[[yay]]")) {
        cheered = true;
        confetti();
        setMood("happy");
        setTimeout(() => mood === "happy" && setMood(speaking.size ? "talking" : "idle"), 1500);
      }
      showSaid(full);
      const { ready, rest } = takeSentences(pending, false);
      if (ready) speak(ready);
      pending = rest;
    }
    if (full.includes("[[oops]]")) throw new Error("oops");
    speak(pending);
    const answer = full.replace(/\[\[(yay|oops)\]\]/g, "").trim();
    if (!answer) throw new Error("empty");
    state.history.push({ role: "assistant", content: answer });
  } catch (err) {
    if (controller.signal.aborted) {
      const partial = full.replace(/\[\[(yay|oops)\]\]/g, "").trim();
      if (partial) state.history.push({ role: "assistant", content: partial });
      else state.history.pop();
      return;
    }
    state.history.pop();
    const line = err.message === "busy"
      ? "Whoa, that's a lot of questions at once! Give me a few seconds to catch my breath."
      : OOPS_LINE;
    stopVoice();
    showSaid(line);
    setMood("oops");
    afterSpeech = "idle";
    speak(line);
    setTimeout(() => mood === "oops" && setMood("idle"), 2500);
  } finally {
    if (state.controller === controller) {
      state.controller = null;
      state.busy = false;
      streamDone = true;
      if (mood === "thinking") setMood("idle");
      maybeFinished();
    }
  }
}

// ---------- voice in ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let heard = { final: "", interim: "" };
let releasing = false;

function primeAudio() {
  if (state.interacted) return;
  state.interacted = true;
  // iOS only lets speech play after a user gesture; a silent utterance unlocks it.
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

function startListening() {
  primeAudio();
  if (!Recognition || rec) return;
  stopEverything();
  heard = { final: "", interim: "" };
  releasing = false;
  rec = new Recognition();
  rec.lang = state.mode === "portuguese" ? state.speakLang : "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) heard.final += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    heard.interim = interim;
    showAsked((heard.final + heard.interim).trim() || "…");
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      showSaid("I can't hear you yet. Please allow the microphone in the browser, then try again.");
      setMood("oops");
    }
  };
  rec.onend = () => {
    const text = (heard.final + heard.interim).trim();
    rec = null;
    talkBtn.classList.remove("held");
    if (text) ask(text);
    else if (releasing) {
      showAsked("");
      showSaid("I didn't quite catch that. Hold the button while you talk, then let go.");
      setMood("idle");
    }
  };
  try {
    rec.start();
  } catch {
    rec = null;
    return;
  }
  talkBtn.classList.add("held");
  showAsked("…");
  showSaid("");
  setMood("listening");
  look(0, 40);
}

function stopListening() {
  if (!rec) return;
  releasing = true;
  // Give the recogniser a moment to deliver the last words before stopping.
  const r = rec;
  setTimeout(() => r.stop(), 250);
}

if (!Recognition) {
  talkBtn.disabled = true;
  $("#talk-label").textContent = "Voice needs Chrome or Safari";
  $("#talk-sub").textContent = "You can still type below";
}

talkBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  talkBtn.setPointerCapture?.(e.pointerId);
  startListening();
});
["pointerup", "pointercancel"].forEach((t) => talkBtn.addEventListener(t, stopListening));
talkBtn.addEventListener("contextmenu", (e) => e.preventDefault());

const typing = () => document.activeElement === typeInput;

window.addEventListener("keydown", (e) => {
  if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) startListening();
  } else if (e.key === "m" || e.key === "M") {
    toggleMute();
  } else if (e.key === "f" || e.key === "F") {
    toggleFullscreen();
  } else if (e.key === "Escape") {
    stopEverything();
    setMood("idle");
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && !typing()) stopListening();
});

typeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  primeAudio();
  const text = typeInput.value;
  typeInput.value = "";
  typeInput.blur();
  ask(text);
});

// ---------- modes, ages, toggles ----------

function greet(speakIt) {
  stopEverything();
  state.history = [];
  showAsked("");
  showSaid(GREETINGS[state.mode]);
  setMood("idle");
  if (speakIt) {
    afterSpeech = "idle";
    speak(GREETINGS[state.mode]);
  }
}

function renderMode() {
  $$(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  $("#speak-lang").hidden = state.mode !== "portuguese" || !Recognition;
}

function renderAge() {
  $$(".ages button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.age === state.age)));
}

function renderSpeakLang() {
  $$(".speak-lang button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === state.speakLang)));
}

const SPEAKER_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function renderMute() {
  muteBtn.innerHTML = state.muted ? SPEAKER_OFF : SPEAKER_ON;
  muteBtn.setAttribute("aria-label", state.muted ? "Turn Pip's voice on" : "Mute Pip's voice");
}

function toggleMute() {
  state.muted = !state.muted;
  store.set("muted", state.muted ? "1" : "0");
  if (state.muted) stopVoice();
  renderMute();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

$$(".modes button").forEach((b) =>
  b.addEventListener("click", () => {
    primeAudio();
    state.mode = b.dataset.mode;
    store.set("mode", state.mode);
    renderMode();
    greet(true);
  }),
);

$$(".ages button").forEach((b) =>
  b.addEventListener("click", () => {
    state.age = b.dataset.age;
    store.set("age", state.age);
    renderAge();
  }),
);

$$(".speak-lang button").forEach((b) =>
  b.addEventListener("click", () => {
    state.speakLang = b.dataset.lang;
    renderSpeakLang();
  }),
);

muteBtn.addEventListener("click", toggleMute);
$("#fullscreen").addEventListener("click", toggleFullscreen);

pip.addEventListener("click", () => {
  primeAudio();
  if (state.busy || speaking.size) {
    stopEverything();
    setMood("idle");
    return;
  }
  setMood("happy");
  setTimeout(() => mood === "happy" && setMood("idle"), 1500);
});

renderMode();
renderAge();
renderSpeakLang();
renderMute();
greet(false);
