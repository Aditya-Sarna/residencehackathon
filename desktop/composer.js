let draft = null;
let recognition = null;
let listening = false;
/** Finalized transcript that remains after speech ends. */
let committed = "";
/** Live partial hypothesis (not yet committed). */
let interim = "";

const titleEl = document.getElementById("title");
const metaEl = document.getElementById("meta");
const textEl = document.getElementById("text");
const errEl = document.getElementById("err");
const sendBtn = document.getElementById("send");
const cancelBtn = document.getElementById("cancel");
const micBtn = document.getElementById("mic");
const micLabel = document.getElementById("micLabel");
const voiceStatus = document.getElementById("voiceStatus");

function SpeechCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function syncTextareaFromSpeech() {
  const live = [committed, interim].filter(Boolean).join(committed && interim ? " " : "");
  // Don't clobber manual edits while not listening
  if (listening || !textEl.value.trim() || textEl.dataset.voiceOwned === "1") {
    textEl.value = live;
    textEl.dataset.voiceOwned = "1";
    textEl.scrollTop = textEl.scrollHeight;
  }
}

function setListeningUI(on) {
  listening = on;
  micBtn.classList.toggle("on", on);
  micBtn.setAttribute("aria-pressed", on ? "true" : "false");
  micLabel.textContent = on ? "Listening…" : "Start listening";
  voiceStatus.textContent = on
    ? "Speak now — pause when done. Text stays so you can edit."
    : committed || textEl.value.trim()
      ? "Transcript kept below. Edit, then Send to pick Notes / Calendar / Reminders."
      : "Audio first — tap the mic, say what to save and where.";
}

function stopListening() {
  if (recognition) {
    try {
      recognition.onend = null;
      recognition.stop();
    } catch {
      /* ignore */
    }
  }
  interim = "";
  syncTextareaFromSpeech();
  setListeningUI(false);
}

function startListening() {
  const Ctor = SpeechCtor();
  if (!Ctor) {
    errEl.hidden = false;
    errEl.textContent =
      "Speech recognition unavailable in this build. Type below, or update macOS Speech settings.";
    return;
  }
  errEl.hidden = true;
  committed = (textEl.value || "").trim();
  interim = "";
  textEl.dataset.voiceOwned = "1";

  recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let finals = "";
    let partial = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) finals += `${piece} `;
      else partial += piece;
    }
    if (finals.trim()) {
      committed = [committed, finals.trim()].filter(Boolean).join(" ").replace(/\s+/g, " ");
    }
    interim = partial.trim();
    syncTextareaFromSpeech();
  };

  recognition.onerror = (event) => {
    const code = event.error || "error";
    if (code === "aborted" || code === "no-speech") return;
    errEl.hidden = false;
    if (code === "not-allowed") {
      errEl.textContent =
        "Microphone blocked. System Settings → Privacy & Security → Microphone → allow Residence.";
    } else if (code === "network") {
      errEl.textContent = "Speech service unreachable. Check network, or type the request.";
    } else {
      errEl.textContent = `Speech error: ${code}`;
    }
    setListeningUI(false);
  };

  recognition.onend = () => {
    // Keep finals; clear interim. Auto-restart while user still wants listening.
    interim = "";
    syncTextareaFromSpeech();
    if (listening) {
      try {
        recognition.start();
      } catch {
        setListeningUI(false);
      }
    } else {
      setListeningUI(false);
    }
  };

  try {
    recognition.start();
    setListeningUI(true);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = String(e.message || e);
    setListeningUI(false);
  }
}

function toggleMic() {
  if (listening) stopListening();
  else startListening();
}

function render(payload) {
  draft = payload || {};
  errEl.hidden = true;
  sendBtn.disabled = false;
  stopListening();

  const voiceFirst = draft.voiceFirst !== false && (draft.method === "voice" || draft.voiceFirst);
  titleEl.textContent = draft.title || (voiceFirst ? "Speak to Residence" : "Send to Residence?");
  metaEl.textContent =
    draft.hint ||
    [draft.appName, draft.source, draft.method, draft.kind]
      .filter(Boolean)
      .join(" · ")
      .replace(/-/g, " ") ||
    "Say where to save — Notes, Calendar, Reminders…";

  committed = draft.text || "";
  interim = "";
  textEl.value = committed;
  textEl.dataset.voiceOwned = committed ? "1" : "0";
  textEl.focus();
  textEl.setSelectionRange(textEl.value.length, textEl.value.length);
  setListeningUI(false);

  if (voiceFirst) {
    // Slight delay so the window is focused before getUserMedia / speech starts
    setTimeout(() => startListening(), 220);
  }
}

async function send() {
  stopListening();
  const text = (textEl.value || "").trim();
  if (!text) {
    errEl.hidden = false;
    errEl.textContent = "Nothing to send yet — speak or type a request.";
    return;
  }
  sendBtn.disabled = true;
  try {
    await window.residence.composerSend(text);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = String(e.message || e);
    sendBtn.disabled = false;
  }
}

textEl.addEventListener("input", () => {
  // User edited — treat textarea as source of truth
  textEl.dataset.voiceOwned = "0";
  committed = textEl.value;
  interim = "";
});

micBtn.addEventListener("click", () => toggleMic());
sendBtn.addEventListener("click", () => send());
cancelBtn.addEventListener("click", () => {
  stopListening();
  window.residence.composerCancel();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    stopListening();
    window.residence.composerCancel();
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    send();
  }
});

window.addEventListener("beforeunload", () => stopListening());

window.residence.onComposer(render);
