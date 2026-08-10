let current = null;
let selectedDestination = "notes";

const titleEl = document.getElementById("title");
const bodyEl = document.getElementById("body");
const metaEl = document.getElementById("meta");
const errEl = document.getElementById("err");
const acceptBtn = document.getElementById("accept");
const declineBtn = document.getElementById("decline");
const previewEl = document.getElementById("source-preview");
const whyEl = document.getElementById("why");
const diffEl = document.getElementById("diff");
const existingEl = document.getElementById("existing");
const incomingEl = document.getElementById("incoming");
const queueEl = document.getElementById("queue");
const navEl = document.getElementById("nav");
const optionsEl = document.getElementById("options");

function setBusy(busy) {
  acceptBtn.disabled = busy;
  declineBtn.disabled = busy;
  optionsEl.querySelectorAll("button").forEach((b) => {
    b.disabled = busy;
  });
}

function buildOptions(item) {
  optionsEl.innerHTML = "";
  const opts = Array.isArray(item.actionOptions) ? item.actionOptions : [];
  if (!opts.length) {
    optionsEl.hidden = true;
    selectedDestination = item.primaryDestination || "notes";
    return;
  }
  optionsEl.hidden = false;
  const primary = opts.find((o) => o.primary) || opts[0];
  selectedDestination = primary?.destination || "notes";

  opts.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      opt.destination === selectedDestination ? "option selected" : "option";
    btn.setAttribute("role", "radio");
    btn.setAttribute(
      "aria-checked",
      opt.destination === selectedDestination ? "true" : "false"
    );
    btn.dataset.destination = opt.destination || "";
    const label = document.createElement("span");
    label.className = "option-label";
    label.textContent = opt.label || opt.destination || "Save";
    const hint = document.createElement("span");
    hint.className = "option-hint";
    hint.textContent =
      opt.hint || (opt.primary ? "Suggested" : "Also available");
    btn.append(label, hint);
    btn.addEventListener("click", () => {
      selectedDestination = opt.destination || "notes";
      optionsEl.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.destination === selectedDestination;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      acceptBtn.textContent = `Accept · ${opt.label || selectedDestination}`;
      acceptBtn.focus();
    });
    optionsEl.appendChild(btn);
  });
  acceptBtn.textContent = `Accept · ${primary?.label || selectedDestination}`;
}

function render(item) {
  current = item;
  errEl.hidden = true;
  setBusy(false);

  const primary = (item.actionOptions || []).find((o) => o.primary);
  if (item.kind === "contradiction") {
    titleEl.textContent = "Memory conflict — accept update?";
  } else if (item.kind === "related_chats") {
    titleEl.textContent = item.title || "Related Claude/GPT chats";
  } else if (primary) {
    titleEl.textContent = primary.label ? `${primary.label}?` : "Add to Residence?";
  } else {
    titleEl.textContent = "Add to Residence?";
  }
  bodyEl.textContent = item.body || item.utterance || "";
  const bits = [item.kind, item.actionApp, item.source, item.captureMethod].filter(
    Boolean
  );
  metaEl.textContent = bits.join(" · ");

  const captured =
    item.utterance || item.payload?.text || item.payload?.incoming || "";
  previewEl.textContent = captured
    ? `${item.source || "Mac"} · ${(item.captureMethod || "capture").replace(/-/g, " ")} · “${captured.slice(0, 280)}${captured.length > 280 ? "…" : ""}”`
    : `${item.source || "Mac"} · ${(item.captureMethod || "capture").replace(/-/g, " ")}`;

  const existing = item.payload?.existing;
  const incoming = item.payload?.incoming || item.payload?.note || captured;
  if (item.kind === "contradiction" && existing) {
    diffEl.hidden = false;
    existingEl.textContent = String(existing).slice(0, 320);
    incomingEl.textContent = String(incoming).slice(0, 320);
  } else {
    diffEl.hidden = true;
  }

  whyEl.textContent =
    item.kind === "contradiction"
      ? "Saved memory disagrees with this capture. Accept updates Facts and writes to the app you pick."
      : item.kind === "related_chats"
        ? "Cross-inference from your image/text against chats already saved in Residence. Accept saves the summary."
        : "Pick Calendar, Notes, or Reminders, then Accept (green) or Decline (red).";

  const qi = item.queueIndex;
  const qt = item.queueTotal;
  if (qt && qt > 1) {
    queueEl.hidden = false;
    queueEl.textContent = `${qi + 1} / ${qt}`;
    navEl.hidden = false;
  } else {
    queueEl.hidden = true;
    navEl.hidden = true;
  }

  buildOptions(item);
  acceptBtn.focus();
}

async function accept() {
  if (!current?.id) return;
  const destination = selectedDestination || current.primaryDestination || "notes";
  setBusy(true);
  try {
    await window.residence.resolve(current.id, true, destination, destination);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = String(e.message || e);
    setBusy(false);
  }
}

async function decline() {
  if (!current?.id) return;
  setBusy(true);
  try {
    await window.residence.resolve(current.id, false, "facts-only");
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = String(e.message || e);
    setBusy(false);
  }
}

acceptBtn.addEventListener("click", () => accept());
declineBtn.addEventListener("click", () => decline());
document.getElementById("prev").addEventListener("click", () =>
  window.residence.inboxNav("prev")
);
document.getElementById("next").addEventListener("click", () =>
  window.residence.inboxNav("next")
);
document.getElementById("decline-rest").addEventListener("click", () =>
  window.residence.inboxDeclineRest()
);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    decline();
    return;
  }
  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    accept();
  }
  if (e.key === "ArrowRight" && (e.metaKey || e.altKey)) {
    e.preventDefault();
    window.residence.inboxNav("next");
  }
  if (e.key === "ArrowLeft" && (e.metaKey || e.altKey)) {
    e.preventDefault();
    window.residence.inboxNav("prev");
  }
  const num = Number(e.key);
  if (num >= 1 && num <= 4 && current?.actionOptions?.[num - 1]) {
    e.preventDefault();
    const opt = current.actionOptions[num - 1];
    selectedDestination = opt.destination;
    optionsEl.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.destination === selectedDestination;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    acceptBtn.textContent = `Accept · ${opt.label || selectedDestination}`;
  }
});

window.residence.onPermission(render);
