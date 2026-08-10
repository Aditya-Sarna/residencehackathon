let current = null;
let selectedDestination = "notes";
let destOpen = false;

const titleEl = document.getElementById("title");
const bodyEl = document.getElementById("body");
const metaEl = document.getElementById("meta");
const whenEl = document.getElementById("when");
const errEl = document.getElementById("err");
const acceptBtn = document.getElementById("accept");
const declineBtn = document.getElementById("decline");
const previewEl = document.getElementById("source-preview");
const whyEl = document.getElementById("why");
const diffEl = document.getElementById("diff");
const existingEl = document.getElementById("existing");
const incomingEl = document.getElementById("incoming");
const queueEl = document.getElementById("queue");
const optionsEl = document.getElementById("options");
const changeBtn = document.getElementById("change-dest");
const noteEl = document.getElementById("personal-note");

function destLabel(destination) {
  if (destination === "calendar") return "Calendar";
  if (destination === "reminders") return "Reminders";
  if (destination === "notes") return "Notes";
  return destination || "Notes";
}

function setBusy(busy) {
  acceptBtn.disabled = busy;
  declineBtn.disabled = busy;
  changeBtn.disabled = busy;
  noteEl.disabled = busy;
  optionsEl.querySelectorAll("button").forEach((b) => {
    b.disabled = busy;
  });
}

function updateAcceptLabel() {
  const opt = (current?.actionOptions || []).find(
    (o) => o.destination === selectedDestination
  );
  const name = opt?.label || destLabel(selectedDestination);
  acceptBtn.textContent = `Save to ${name}`;
  changeBtn.textContent = destOpen
    ? "Hide destinations"
    : `Saving to ${name} · change`;
}

function buildOptions(item) {
  optionsEl.innerHTML = "";
  const opts = Array.isArray(item.actionOptions) ? item.actionOptions : [];
  if (!opts.length) {
    selectedDestination = item.primaryDestination || "notes";
    updateAcceptLabel();
    return;
  }
  const primary = opts.find((o) => o.primary) || opts[0];
  selectedDestination = primary?.destination || item.primaryDestination || "notes";

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
    label.textContent = opt.label || destLabel(opt.destination);
    const hint = document.createElement("span");
    hint.className = "option-hint";
    hint.textContent = opt.hint || (opt.primary ? "Suggested" : "Also fine");
    btn.append(label, hint);
    btn.addEventListener("click", () => {
      selectedDestination = opt.destination || "notes";
      optionsEl.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.destination === selectedDestination;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      updateAcceptLabel();
      acceptBtn.focus();
    });
    optionsEl.appendChild(btn);
  });
  updateAcceptLabel();
}

function render(item) {
  current = item;
  errEl.hidden = true;
  setBusy(false);
  destOpen = false;
  optionsEl.hidden = true;
  noteEl.value = "";

  if (item.kind === "contradiction") {
    titleEl.textContent = "Update saved memory?";
  } else if (item.kind === "related_chats") {
    titleEl.textContent = item.title || "Related chats";
  } else {
    titleEl.textContent = "Save this?";
  }

  bodyEl.textContent = item.body || item.utterance || item.summary || "";

  const when =
    item.whenLabel ||
    item.payload?.whenLabel ||
    (item.primaryDestination === "calendar" || item.actionApp === "calendar"
      ? ""
      : "");
  if (when) {
    whenEl.hidden = false;
    whenEl.textContent = when;
  } else if (
    (item.primaryDestination || item.actionApp) === "calendar" ||
    item.actionApp === "calendar"
  ) {
    whenEl.hidden = false;
    whenEl.textContent = "No time set — uses 10:00 AM";
  } else {
    whenEl.hidden = true;
    whenEl.textContent = "";
  }

  const bits = [item.source, item.captureMethod && String(item.captureMethod).replace(/-/g, " ")]
    .filter(Boolean);
  metaEl.textContent = bits.join(" · ");

  const captured =
    item.utterance || item.payload?.text || item.payload?.incoming || "";
  previewEl.textContent = captured
    ? `“${captured.slice(0, 280)}${captured.length > 280 ? "…" : ""}”`
    : item.summary || "—";

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
      ? "What you saved before doesn’t match this capture. Save keeps the new version."
      : item.kind === "related_chats"
        ? "We found related Claude/GPT chats. Save keeps a short digest."
        : "We’ll save this to your personal graph and the app you choose.";

  const qi = item.queueIndex;
  const qt = item.queueTotal;
  if (qt && qt > 1) {
    queueEl.hidden = false;
    queueEl.textContent = `${qi + 1} of ${qt}`;
  } else {
    queueEl.hidden = true;
  }

  buildOptions(item);
  acceptBtn.focus();
}

async function accept() {
  if (!current?.id) return;
  const destination = selectedDestination || current.primaryDestination || "notes";
  const personalNote = noteEl.value.trim();
  setBusy(true);
  try {
    await window.residence.resolve(
      current.id,
      true,
      destination,
      destination,
      personalNote
    );
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
changeBtn.addEventListener("click", () => {
  destOpen = !destOpen;
  optionsEl.hidden = !destOpen;
  updateAcceptLabel();
});

window.addEventListener("keydown", (e) => {
  if (e.target === noteEl) {
    if (e.key === "Escape") {
      e.preventDefault();
      decline();
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    decline();
    return;
  }
  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    accept();
  }
  const num = Number(e.key);
  if (num >= 1 && num <= 4 && current?.actionOptions?.[num - 1]) {
    e.preventDefault();
    destOpen = true;
    optionsEl.hidden = false;
    const opt = current.actionOptions[num - 1];
    selectedDestination = opt.destination;
    optionsEl.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.destination === selectedDestination;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    updateAcceptLabel();
  }
});

window.residence.onPermission(render);
