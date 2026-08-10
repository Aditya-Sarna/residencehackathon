let draft = null;

const titleEl = document.getElementById("title");
const metaEl = document.getElementById("meta");
const textEl = document.getElementById("text");
const errEl = document.getElementById("err");
const sendBtn = document.getElementById("send");
const cancelBtn = document.getElementById("cancel");

function render(payload) {
  draft = payload || {};
  errEl.hidden = true;
  sendBtn.disabled = false;
  titleEl.textContent = draft.title || "Send to Residence?";
  metaEl.textContent = [draft.appName, draft.source, draft.method, draft.kind]
    .filter(Boolean)
    .join(" · ")
    .replace(/-/g, " ");
  textEl.value = draft.text || "";
  textEl.focus();
  textEl.setSelectionRange(textEl.value.length, textEl.value.length);
}

async function send() {
  const text = (textEl.value || "").trim();
  if (!text) {
    errEl.hidden = false;
    errEl.textContent = "Capture is empty.";
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

sendBtn.addEventListener("click", () => send());
cancelBtn.addEventListener("click", () => window.residence.composerCancel());

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    window.residence.composerCancel();
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    send();
  }
});

window.residence.onComposer(render);
