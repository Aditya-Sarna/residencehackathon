const electron = require("electron");

if (!electron || typeof electron === "string" || !electron.app) {
  console.error(
    "Residence must be launched with Electron, not Node.\n" +
      "Use: npm start   or open Residence.app"
  );
  process.exit(1);
}

const {
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  BrowserWindow,
  globalShortcut,
  clipboard,
  shell,
  dialog,
  ipcMain,
  systemPreferences,
  session,
} = electron;

const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const mac = require("./integrations/macos");

const CORE = process.env.RESIDENCE_CORE_URL || "http://127.0.0.1:8700";
const API_KEY = process.env.RESIDENCE_API_KEY || "";
const POLL_MS_OK = 2500;
const POLL_MS_MAX = 30000;
const HOTKEY = "CommandOrControl+Shift+R";
const HOTKEY_CLIP = "CommandOrControl+Shift+C";
const HOTKEY_ACCEPT = "CommandOrControl+Shift+A";
const HOTKEY_DECLINE = "CommandOrControl+Shift+D";
const HOTKEY_UNDO = "CommandOrControl+Shift+Z";
const HOTKEY_INBOX = "CommandOrControl+Shift+I";

/** Headless health report: `Residence --selftest`. Skips the tray and windows. */
const SELFTEST =
  process.argv.includes("--selftest") || process.env.RESIDENCE_SELFTEST === "1";

if (!SELFTEST) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    // Another copy already owns the menu bar — most often a stale build the user
    // still has in Downloads.
    console.error("Residence is already running — quit the other copy first.");
    app.quit();
    process.exit(0);
  }
}

let tray = null;
let statusWin = null;
let pollTimer = null;
let pollMs = POLL_MS_OK;
const lastNotifiedIds = new Set();
let coreOk = false;
let lastCaptureMeta = null;
let consecutiveCoreFails = 0;
let pendingCount = 0;
let acceptStack = []; // multi-undo stack
let pendingInbox = [];
let inboxIndex = 0;
let composerDraft = null;
let failedHotkeys = [];
let lastDockBounceAt = 0;
let frontmostTracker = null;

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => pollPending(), pollMs);
}

function integrationPolicyId(capture) {
  const source = capture?.source || "";
  if (source === "browser") {
    return /safari/i.test(capture?.appName || "") ? "safari" : "chrome";
  }
  if (source === "apple-notes") return "notes";
  if (source === "apple-calendar") return "calendar";
  if (source === "apple-mail") return "mail";
  if (source === "shopping") return "shopping";
  if (source === "maps") return "maps";
  if (source === "music") return "music";
  if (source === "linkedin") return "linkedin";
  if (source === "github") return "github";
  if (source === "meeting-link") return "meeting";
  if (source === "rideshare") return "rideshare";
  if (source === "travel-book") return "travel";
  if (source === "read-later") return "read-later";
  if (source === "work-tracker") return "work-tracker";
  if (source === "ai-chat") return "ai-chat";
  if (source === "gmail") return "gmail";
  if (source === "youtube") return "youtube";
  return source;
}

const settingsPath = () =>
  path.join(app.getPath("userData"), "integrations.json");
const logPath = () => path.join(app.getPath("userData"), "residence-desktop.log");
const outboxPath = () => path.join(app.getPath("userData"), "capture-outbox.json");
const writebackPath = () => path.join(app.getPath("userData"), "writeback-retry.json");

function fileLog(line) {
  try {
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

function defaultSettings() {
  return {
    writeBack: true,
    enabled: {},
    capturePolicies: {},
    writeBackPolicies: {},
    firstRunDone: false,
    /** Skip composer — capture goes straight to the one Accept sheet. */
    confirmCapture: false,
    openAtLogin: false,
    showDock: false,
    quietHours: { enabled: false, startHour: 22, endHour: 8 },
    morningBriefing: true,
    /** 2 = one-click Accept writes to Calendar/Notes/Reminders (no second confirm). */
    flowVersion: 2,
  };
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    const s = { ...defaultSettings(), ...parsed };
    // Migrate once: drop the double Accept (Facts → then Write to Mac).
    if (Number(parsed.flowVersion || 0) < 2) {
      s.confirmCapture = false;
      s.flowVersion = 2;
      const policies = { ...(s.writeBackPolicies || {}) };
      for (const [k, v] of Object.entries(policies)) {
        if (v === "confirm") policies[k] = "on";
      }
      s.writeBackPolicies = policies;
      saveSettings(s);
    }
    return s;
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s) {
  try {
    writeJson(settingsPath(), s);
  } catch (e) {
    fileLog(`settings error ${e}`);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function loadOutbox() {
  return readJson(outboxPath(), []).slice(0, 100);
}

function saveOutbox(rows) {
  writeJson(outboxPath(), rows.slice(0, 100));
}

function enqueueCapture(text, source, meta = {}) {
  const digest = crypto.createHash("sha256").update(text).digest("hex");
  const rows = loadOutbox();
  const existing = rows.find(
    (r) => r.contentHash === digest && r.source === source && r.status !== "sent"
  );
  if (existing) return existing;
  const row = {
    operationId: crypto.randomUUID(),
    contentHash: digest,
    text: text.slice(0, 32000),
    source,
    captureMethod: meta.method || "explicit",
    consentMode: "explicit",
    capturedAt: Date.now(),
    attempts: 0,
    nextRetryAt: 0,
    status: "queued",
  };
  rows.unshift(row);
  saveOutbox(rows);
  return row;
}

function loadWritebackRetries() {
  return readJson(writebackPath(), []).slice(0, 100);
}

function saveWritebackRetries(rows) {
  writeJson(writebackPath(), rows.slice(0, 100));
}

function inQuietHours() {
  const q = loadSettings().quietHours || {};
  if (!q.enabled) return false;
  const hour = new Date().getHours();
  const start = Number(q.startHour ?? 22);
  const end = Number(q.endHour ?? 8);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function writePolicyForItem(item) {
  const s = loadSettings();
  const policies = s.writeBackPolicies || {};
  const keys = [
    item?.actionApp,
    integrationPolicyId(item || {}),
    item?.source,
    item?.payload?.q,
  ].filter(Boolean);
  for (const k of keys) {
    if (policies[k] === "off") return "off";
  }
  for (const k of keys) {
    if (policies[k] === "on") return "on";
    if (policies[k] === "confirm") return "confirm";
  }
  // Default: Accept once → write immediately (Integrations can set write=confirm).
  return "on";
}

function writeTargetsForItem(item) {
  const app = item?.actionApp || "";
  const q = item?.payload?.q || "";
  if (q === "youtube" || q === "music" || q === "github" || q === "read-later" || q === "shopping")
    return "Reminders";
  if (q === "maps") return "Notes + Reminders";
  if (q === "linkedin" || q === "rideshare") return "Calendar + Reminders";
  if (app === "calendar") return "Calendar (+ Reminders if needed)";
  if (app === "wellness" || app === "notes") return "Notes";
  if (app === "wallet" || app === "shop") return "Reminders";
  return "Calendar / Notes / Reminders";
}

/**
 * Smart choice sheet: inferred primary action + relevant Mac destinations.
 * One tap = Facts + write to that app.
 */
function buildActionOptions(item) {
  const app = String(item?.actionApp || "");
  const q = String(item?.payload?.q || "");
  const text = String(item?.utterance || item?.payload?.text || item?.body || "");
  const title = String(item?.title || "");
  const options = [];
  const seen = new Set();

  const push = (opt) => {
    if (!opt?.id || seen.has(opt.id)) return;
    seen.add(opt.id);
    options.push(opt);
  };

  if (item?.kind === "contradiction") {
    // Contradictions resolve the Fact graph itself, not a Mac destination —
    // the pill shows a dedicated Accept/Decline choice for these.
    return [
      {
        id: "notes",
        label: "Accept new",
        hint: "Update the shared Fact",
        destination: "notes",
        primary: true,
      },
    ];
  }
  if (item?.kind === "related_chats" || q === "related_chats") {
    push({
      id: "notes",
      label: "Notes",
      hint: "Save the chat summary",
      destination: "notes",
      primary: true,
    });
    push({
      id: "reminders",
      label: "Reminders",
      hint: "Keep as a reminder",
      destination: "reminders",
      primary: false,
    });
    options.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
    return options.slice(0, 3);
  }

  const looksCalendar =
    app === "calendar" ||
    q === "linkedin" ||
    q === "rideshare" ||
    /lunch|dinner|meet|meeting|tomorrow|calendar|appointment|at \d{1,2}|on the \d+/i.test(
      `${title} ${text}`
    );
  const looksReminder =
    q === "youtube" ||
    q === "read-later" ||
    q === "github" ||
    q === "music" ||
    q === "shopping" ||
    app === "shop" ||
    app === "wallet" ||
    /watch later|remind|todo|buy |shopping/i.test(`${title} ${text}`);
  const looksNotes =
    app === "wellness" ||
    app === "notes" ||
    q === "maps" ||
    item?.kind === "contradiction" ||
    /note|allergy|allergic|remember that|health/i.test(`${title} ${text}`);

  if (looksCalendar) {
    push({
      id: "calendar",
      label: "Calendar",
      hint: "Add an event",
      destination: "calendar",
      primary: app === "calendar" || (!looksReminder && !looksNotes),
    });
  }
  if (looksReminder) {
    let hint = "Add a reminder";
    if (q === "youtube") hint = "Watch later";
    else if (q === "shopping" || app === "shop") hint = "Shopping list";
    else if (q === "github") hint = "Review later";
    else if (q === "read-later") hint = "Read later";
    push({
      id: "reminders",
      label: "Reminders",
      hint,
      destination: "reminders",
      primary: app !== "calendar" && app !== "wellness" && app !== "notes",
    });
  }
  if (looksNotes) {
    push({
      id: "notes",
      label: "Notes",
      hint: "Save a note",
      destination: "notes",
      primary: app === "wellness" || app === "notes",
    });
  }

  // Always offer the three destinations so the user can override inference.
  push({
    id: "calendar",
    label: "Calendar",
    hint: "Add an event",
    destination: "calendar",
    primary: false,
  });
  push({
    id: "notes",
    label: "Notes",
    hint: "Save a note",
    destination: "notes",
    primary: false,
  });
  push({
    id: "reminders",
    label: "Reminders",
    hint: "Add a reminder",
    destination: "reminders",
    primary: false,
  });

  options.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  // Keep at most one primary highlight.
  let sawPrimary = false;
  for (const o of options) {
    if (o.primary && sawPrimary) o.primary = false;
    if (o.primary) sawPrimary = true;
  }
  return options.slice(0, 4);
}

function decoratePermission(item, index = 0, total = 1) {
  const policy = writePolicyForItem(item);
  const options = buildActionOptions(item);
  const primary = options.find((o) => o.primary) || options[0];
  const payload = { ...(item.payload || {}) };
  let whenLabel = payload.whenLabel || "";
  const dest = primary?.destination || "notes";
  if (!whenLabel && (dest === "calendar" || item.actionApp === "calendar")) {
    try {
      whenLabel = mac.resolveEventSchedule(payload).label;
    } catch {
      whenLabel = "";
    }
  }
  const summary =
    payload.summary ||
    mac.summarizeContent(
      item.utterance || payload.text || payload.incoming || payload.note || item.body || ""
    );
  return {
    ...item,
    payload: { ...payload, whenLabel, summary },
    queueIndex: index,
    queueTotal: total,
    writePolicy: policy,
    needsWriteConfirm: false,
    writeTargets: writeTargetsForItem(item),
    actionOptions: options,
    primaryDestination: dest,
    whenLabel,
    summary,
  };
}

function apiOnce(method, pathname, body) {
  const url = new URL(pathname, CORE);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
    };
    if (API_KEY) {
      headers.Authorization = `Bearer ${API_KEY}`;
      headers["X-Residence-Key"] = API_KEY;
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 12000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, json: { raw: data } });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function api(method, pathname, body, { retries = 0 } = {}) {
  let last;
  const attempts = Math.max(0, retries) + 1;
  for (let i = 0; i < attempts; i++) {
    last = await apiOnce(method, pathname, body);
    if (last.status !== 429) return last;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  return last;
}

function trayIcon(count = 0) {
  // Electron Tray on macOS often fails to render SVG data-URLs (blank icon).
  // Prefer a template PNG so the system tints it for light/dark menu bars.
  const candidates = [
    path.join(__dirname, "assets", "IconTemplate.png"),
    path.join(__dirname, "assets", "trayTemplate.png"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) continue;
      img.setTemplateImage(true);
      return img;
    } catch {
      /* try next */
    }
  }
  // Last resort: tiny black square PNG so the slot still appears.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    "base64"
  );
  const fallback = nativeImage.createFromBuffer(png);
  fallback.setTemplateImage(true);
  return fallback;
}

function updateTrayBadge(count) {
  pendingCount = count;
  if (!tray) return;
  tray.setImage(trayIcon(count));
  // Always show text "R" so the item is findable even if the image fails.
  tray.setTitle(count > 0 ? ` R ${count}` : " R");
  const quiet = inQuietHours() ? " · quiet hours" : "";
  tray.setToolTip(
    coreOk
      ? count
        ? `Residence — ${count} pending${quiet}`
        : `Residence — menu bar agent${quiet}`
      : "Residence — Core offline"
  );
  if (app.dock && loadSettings().showDock) {
    app.dock.setBadge(count > 0 ? String(count) : "");
  }
  pushStatusRefresh();
}

function showNote(title, body, opts = {}) {
  if (!Notification.isSupported()) return null;
  if (inQuietHours() && !opts.force) return null;
  const n = new Notification({
    title,
    body,
    silent: !!opts.silent || inQuietHours(),
    urgency: opts.urgency || "normal",
    actions: opts.actions || [],
  });
  if (opts.onClick) n.on("click", opts.onClick);
  if (opts.onAction) n.on("action", opts.onAction);
  n.show();
  return n;
}

function showCaptureHud(payload) {
  // All chrome lives in the pill — surfaced as a timed toast line.
  showToast({
    kicker: payload?.kicker,
    title: payload?.title,
    body: payload?.body,
    tone: payload?.tone,
    ms: payload?.ms,
  });
}

/**
 * Toasts ride their own channel so a routine status refresh can never wipe out
 * the one line telling the user their capture was saved.
 */
function showToast({ kicker, title, body, tone = "info", ms, fix = null, fixSecondary = null } = {}) {
  const win = ensureStatusWin();
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  const serialise = (f) =>
    f && f.label && f.action ? { label: f.label, action: f.action } : null;
  sendToPill(win, "toast", {
    kicker: kicker || "",
    title: title || "",
    body: body || "",
    tone,
    ms: ms || (tone === "error" ? 7000 : 3500),
    // Serialisable action name only — the renderer maps it to a real handler.
    fix: serialise(fix),
    fixSecondary: serialise(fixSecondary),
  });
}

const PILL_WIDTH = 520;
const PILL_HEIGHTS = { actions: 132, apps: 132, prefs: 132, fix: 132, compose: 196, decide: 196 };

function sizePill(bank) {
  if (!statusWin || statusWin.isDestroyed()) return;
  statusWin.setContentSize(PILL_WIDTH, PILL_HEIGHTS[bank] || PILL_HEIGHTS.actions);
}

function ensureStatusWin() {
  if (statusWin && !statusWin.isDestroyed()) return statusWin;
  openStatus({ activate: false });
  return statusWin;
}

function sendToPill(win, channel, payload) {
  const send = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

/**
 * @param {"actions"|"apps"|"prefs"|"fix"|"compose"|"decide"} view
 * @param {object} payload
 * @param {{activate?: boolean}} opts  activate=false surfaces the pill without
 *   stealing focus, which is what background events (new pending items, poll
 *   results) must do so the user can keep typing in whatever app they are in.
 */
function pushPill(view, payload = {}, opts = {}) {
  const win = ensureStatusWin();
  if (!win) return;
  const activate = opts.activate === true;
  sizePill(view);
  if (activate) {
    win.show();
    win.focus();
  } else if (!win.isVisible()) {
    win.showInactive();
  }
  sendToPill(win, "pill", { view, ...payload });
}

/**
 * Full-pill green checkmark flash, played whenever a capture is actually
 * written to the shared Fact graph. This is the one moment the user should
 * feel "that's saved" without reading anything.
 */
function flashSaved({ title = "", body = "" } = {}) {
  const win = ensureStatusWin();
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  sendToPill(win, "saved", { title, body });
}

function notifyOffline() {
  showNote(
    "Residence",
    "Core is offline. Start: cd core && uvicorn main:app --port 8700",
    { force: true }
  );
}

function applyLoginItem(openAtLogin) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!openAtLogin, openAsHidden: true });
  } catch (e) {
    fileLog(`login item failed ${e}`);
  }
}

function applyDockPreference(showDock) {
  if (!app.dock) return;
  if (showDock) app.dock.show();
  else app.dock.hide();
}

function setTrayMenu() {
  if (!tray) return;
  const settings = loadSettings();
  const integrationItems = mac.INTEGRATIONS.map((i) => ({
    label: i.name,
    type: "checkbox",
    checked: settings.enabled[i.id] !== false,
    click: (item) => {
      const s = loadSettings();
      s.enabled[i.id] = item.checked;
      saveSettings(s);
      setTrayMenu();
    },
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: coreOk
        ? pendingCount
          ? `Core connected · ${pendingCount} pending`
          : "Core connected · menu bar agent"
        : "Core offline — start uvicorn :8700",
      enabled: false,
    },
    ...(failedHotkeys.length
      ? [
          {
            label: `Hotkey conflict: ${failedHotkeys.join(", ")}`,
            enabled: false,
          },
        ]
      : []),
    ...(!hasAccessibility() && !accessibilityNagDismissed
      ? [
          {
            label: "Refresh Accessibility…",
            click: () =>
              ensureAccessibility({ reason: "tray", openSettings: true, force: true }),
          },
        ]
      : []),
    { type: "separator" },
    {
      label:
        statusWin && !statusWin.isDestroyed() && statusWin.isVisible()
          ? "Hide Residence (Esc)"
          : "Show Residence",
      click: () => toggleStatus(),
    },
    { label: "Capture from front app (⌘⇧R)", click: () => captureSmart() },
    { label: "Capture clipboard only (⌘⇧C)", click: () => captureClipboard() },
    {
      label: "Recall chats from clipboard image",
      click: () => recallClipboardImage(),
    },
    {
      label: "Morning briefing…",
      click: () => runMorningBriefing({ force: true }),
    },
    {
      label: "Sync Calendar (7 days)…",
      click: () => syncAppleCalendar({ notify: true }),
    },
    {
      label: "Review inbox (⌘⇧I)",
      click: () => openInbox(),
    },
    {
      label: "Do suggested action (⌘⇧A)",
      enabled: pendingCount > 0,
      click: () => resolveTopPending(true),
    },
    {
      label: "Dismiss top pending (⌘⇧D)",
      enabled: pendingCount > 0,
      click: () => resolveTopPending(false),
    },
    {
      label: `Undo last Accept (⌘⇧Z)${acceptStack.length ? ` · ${acceptStack.length}` : ""}`,
      enabled: acceptStack.length > 0,
      click: () => undoLastAccept(),
    },
    {
      label: "Integrations…",
      click: () => openStatus({ activate: true, view: "apps" }),
    },
    {
      label: "Edit before send (extra step)",
      type: "checkbox",
      checked: settings.confirmCapture === true,
      click: (item) => {
        const s = loadSettings();
        s.confirmCapture = !!item.checked;
        saveSettings(s);
      },
    },
    {
      label: "Write back to Mac apps",
      type: "checkbox",
      checked: settings.writeBack !== false,
      click: (item) => {
        const s = loadSettings();
        s.writeBack = item.checked;
        saveSettings(s);
      },
    },
    {
      label: "Open at login",
      type: "checkbox",
      checked: !!settings.openAtLogin,
      click: (item) => {
        const s = loadSettings();
        s.openAtLogin = item.checked;
        saveSettings(s);
        applyLoginItem(item.checked);
      },
    },
    {
      label: "Show Dock icon",
      type: "checkbox",
      checked: !!settings.showDock,
      click: (item) => {
        const s = loadSettings();
        s.showDock = item.checked;
        saveSettings(s);
        applyDockPreference(item.checked);
      },
    },
    {
      label: "Quiet hours (22:00–08:00)",
      type: "checkbox",
      checked: !!settings.quietHours?.enabled,
      click: (item) => {
        const s = loadSettings();
        s.quietHours = {
          ...(s.quietHours || { startHour: 22, endHour: 8 }),
          enabled: item.checked,
        };
        saveSettings(s);
        updateTrayBadge(pendingCount);
      },
    },
    {
      label: "Morning briefing after quiet hours",
      type: "checkbox",
      checked: settings.morningBriefing !== false,
      click: (item) => {
        const s = loadSettings();
        s.morningBriefing = item.checked;
        saveSettings(s);
        scheduleMorningBriefing();
      },
    },
    { type: "separator" },
    { label: "Connected apps", enabled: false },
    ...integrationItems,
    { type: "separator" },
    {
      label: "Open phone UI",
      click: () => shell.openExternal("http://localhost:5173/"),
    },
    {
      label: "Install Claude MCP…",
      click: () => {
        const cfg = path.join(
          app.getPath("home"),
          "Library/Application Support/Claude/claude_desktop_config.json"
        );
        dialog.showMessageBox({
          type: "info",
          title: "Claude Desktop MCP",
          message: "Residence MCP is configured for Claude Desktop.",
          detail:
            `Config: ${cfg}\n\nFully quit Claude (⌘Q) and reopen, then ask: “Save this to Residence…”.\n\nKeep Core on :8700.`,
        });
        shell.showItemInFolder(cfg);
      },
    },
    { label: "Run diagnostics…", click: () => showDiagnostics() },
    {
      label: "Open log file",
      click: () => shell.showItemInFolder(logPath()),
    },
    { type: "separator" },
    { label: "Quit Residence", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  updateTrayBadge(pendingCount);
}

async function openInbox({ activate = true } = {}) {
  try {
    const { json } = await api("GET", "/desktop/pending");
    pendingInbox = json.pending || [];
    inboxIndex = 0;
    updateTrayBadge(pendingInbox.length);
    if (!pendingInbox.length) {
      showToast({ kicker: "Inbox", title: "Nothing to review" });
      pushPill("actions", {}, { activate });
      return;
    }
    openPermission(decoratePermission(pendingInbox[0], 0, pendingInbox.length), {
      activate,
    });
  } catch {
    notifyOffline();
  }
}

function inboxShowCurrent({ activate = false } = {}) {
  if (!pendingInbox.length) {
    showToast({ kicker: "Inbox", title: "All caught up" });
    pushPill("actions", {}, { activate });
    return;
  }
  inboxIndex = Math.max(0, Math.min(inboxIndex, pendingInbox.length - 1));
  openPermission(
    decoratePermission(pendingInbox[inboxIndex], inboxIndex, pendingInbox.length),
    { activate }
  );
}

async function resolveTopPending(accept) {
  try {
    const { json } = await api("GET", "/desktop/pending");
    const pending = json.pending || [];
    if (!pending.length) {
      showNote("Residence", "Nothing to resolve.", { force: true });
      return;
    }
    const decorated = decoratePermission(pending[0], 0, pending.length);
    if (!accept) {
      await resolvePermission(decorated.id, false, decorated, {
        writeMode: "facts-only",
      });
      return;
    }
    // Cmd+Shift+A = primary inferred destination (one tap done).
    await resolvePermission(decorated.id, true, decorated, {
      destination: decorated.primaryDestination || "notes",
      writeMode: decorated.primaryDestination || "notes",
    });
  } catch (e) {
    showNote("Residence", String(e.message || e), { force: true });
  }
}

async function undoLastAccept() {
  const last = acceptStack[0];
  if (!last?.factId) {
    showNote("Residence", "Nothing to undo.", { force: true });
    return;
  }
  try {
    const { status, json } = await api("POST", "/desktop/undo", {
      fact_id: last.factId,
      permission_id: last.permissionId,
      operation_id: last.operationId,
    });
    if (status >= 400) throw new Error(json.detail || "undo failed");
    acceptStack.shift();
    showToast({
      kicker: "Undone",
      title: last.title || "Reverted",
      body: "Removed from Facts and Mac apps.",
    });
    setTrayMenu();
  } catch (e) {
    showToast({
      kicker: "Undo failed",
      title: String(e.message || e).slice(0, 90),
      tone: "error",
    });
  }
}

function pushStatusRefresh() {
  if (statusWin && !statusWin.isDestroyed()) {
    statusWin.webContents.send("status-refresh", { at: Date.now() });
  }
}

const pillStatePath = () => path.join(app.getPath("userData"), "pill-window.json");

function savePillPosition() {
  if (!statusWin || statusWin.isDestroyed()) return;
  try {
    const [x, y] = statusWin.getPosition();
    writeJson(pillStatePath(), { x, y });
  } catch {
    /* position is a nicety, never fail the app over it */
  }
}

/** Default resting place: bottom-centre of the active display, above the Dock. */
function defaultPillPosition() {
  const { screen } = electron;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - PILL_WIDTH) / 2),
    y: Math.round(area.y + area.height - PILL_HEIGHTS.actions - 28),
  };
}

function applyPillPosition(win) {
  const { screen } = electron;
  const saved = readJson(pillStatePath(), null);
  if (
    saved &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    // Drop stale coordinates from a monitor that is no longer attached.
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        saved.x >= a.x - PILL_WIDTH / 2 &&
        saved.x <= a.x + a.width - PILL_WIDTH / 2 &&
        saved.y >= a.y - 40 &&
        saved.y <= a.y + a.height - 40
      );
    })
  ) {
    win.setPosition(saved.x, saved.y);
    return;
  }
  const { x, y } = defaultPillPosition();
  win.setPosition(x, y);
}

function hideStatus() {
  if (statusWin && !statusWin.isDestroyed() && statusWin.isVisible()) {
    savePillPosition();
    statusWin.hide();
  }
}

function toggleStatus() {
  if (statusWin && !statusWin.isDestroyed() && statusWin.isVisible()) {
    hideStatus();
    return;
  }
  openStatus({ activate: true });
}

function openStatus({ activate = true, view = null } = {}) {
  if (statusWin && !statusWin.isDestroyed()) {
    if (activate) {
      statusWin.show();
      statusWin.focus();
    } else if (!statusWin.isVisible()) {
      statusWin.showInactive();
    }
    if (view) pushPill(view, {}, { activate });
    pushStatusRefresh();
    return;
  }
  statusWin = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHTS.actions,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "Residence",
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  // Float above full-screen apps without pulling the user out of their space.
  statusWin.setAlwaysOnTop(true, "floating");
  statusWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyPillPosition(statusWin);
  statusWin.loadFile(path.join(__dirname, "status.html"));

  statusWin.once("ready-to-show", () => {
    if (activate) statusWin.show();
    else statusWin.showInactive();
    if (view) pushPill(view, {}, { activate });
  });
  statusWin.on("moved", savePillPosition);
  statusWin.on("closed", () => {
    statusWin = null;
  });
  // Esc anywhere in the pill puts it away.
  statusWin.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      hideStatus();
    }
  });
}

function openPermission(item, { activate = false } = {}) {
  // Accept / destination UI lives entirely in the pill.
  pushPill("decide", { item }, { activate });
}

/** Typed review/edit step — used for "Edit before send" and manual capture. */
function openComposer(draft, { activate = true } = {}) {
  composerDraft = draft;
  pushPill("compose", { draft }, { activate });
}

async function deliverCapture(row, openReview = true, { quiet = false } = {}) {
  const { status, json } = await api("POST", "/desktop/capture", {
    text: row.text,
    source: row.source || "macos",
    operation_id: row.operationId,
    capture_method: row.captureMethod,
    consent_mode: row.consentMode,
  });
  if (status >= 400) throw new Error(json.detail || "capture failed");
  const rows = loadOutbox().filter((r) => r.operationId !== row.operationId);
  saveOutbox(rows);
  const queuedItems = json.queued || [];
  const first = queuedItems[0];
  const queued = queuedItems.length;
  if (!quiet) {
    showCaptureHud({
      kicker: first?.kind === "contradiction" ? "Contradiction" : "Captured",
      title: first?.title || "Context understood",
      body: first?.body || row.text.slice(0, 160),
      app: lastCaptureMeta?.appName || row.source,
      method: row.captureMethod,
      queued,
    });
  }
  if (first && openReview) {
    pendingInbox = queuedItems;
    inboxIndex = 0;
    // The user just triggered this, so it is fair to take focus for the choice.
    openPermission(decoratePermission(first, 0, queuedItems.length), { activate: true });
  } else if (!first) {
    showToast({ kicker: "Captured", title: "Saved to Facts", body: row.text.slice(0, 120) });
  }
  await pollPending(true);
  return json;
}

/** New pending items surface only in the pill — no OS notification sheets. */
function showDecisionNotification(item, relatedCount = 1) {
  pendingInbox = pendingInbox.length ? pendingInbox : [item];
  if (!pendingInbox.find((p) => p.id === item.id)) {
    pendingInbox.unshift(item);
  }
  inboxIndex = Math.max(
    0,
    pendingInbox.findIndex((p) => p.id === item.id)
  );
  openPermission(
    decoratePermission(item, inboxIndex, Math.max(relatedCount, pendingInbox.length))
  );
}

async function postCapture(text, source, meta = {}) {
  const row = enqueueCapture(text, source, meta);
  try {
    return await deliverCapture(row);
  } catch (e) {
    const rows = loadOutbox();
    const stored = rows.find((r) => r.operationId === row.operationId);
    if (stored) {
      stored.attempts += 1;
      stored.nextRetryAt = Date.now() + Math.min(30000, 1000 * 2 ** stored.attempts);
      stored.lastError = String(e.message || e);
      saveOutbox(rows);
    }
    throw e;
  }
}

let flushingOutbox = false;

async function flushOutbox() {
  // Polls overlap with slow deliveries; without this guard a queued capture can
  // be sent twice.
  if (flushingOutbox) return;
  flushingOutbox = true;
  try {
    await flushOutboxOnce();
  } finally {
    flushingOutbox = false;
  }
}

async function flushOutboxOnce() {
  const now = Date.now();
  let coreDown = false;
  let delivered = 0;
  for (const row of loadOutbox().filter((r) => !r.nextRetryAt || r.nextRetryAt <= now)) {
    if (coreDown) break;
    try {
      await deliverCapture(row, false, { quiet: true });
      delivered += 1;
      fileLog(`capture delivered ${row.operationId}`);
    } catch (e) {
      const msg = String(e.message || e);
      row.attempts = (row.attempts || 0) + 1;
      row.nextRetryAt = now + Math.min(30000, 1000 * 2 ** row.attempts);
      row.lastError = msg;
      const rows = loadOutbox();
      const stored = rows.find((r) => r.operationId === row.operationId);
      if (stored) Object.assign(stored, row);
      saveOutbox(rows);
      // Keep flushing siblings unless Core itself is unreachable
      if (/timeout|ECONNREFUSED|offline|fetch failed/i.test(msg)) {
        coreDown = true;
      }
    }
  }
  if (delivered) {
    showToast({
      kicker: "Back online",
      title: `Sent ${delivered} queued capture${delivered > 1 ? "s" : ""}`,
      body: "Review them in the inbox.",
    });
  }
}

function clipboardImagePayload() {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    const png = img.toPNG();
    if (!png || !png.length) return null;
    return {
      image_base64: Buffer.from(png).toString("base64"),
      media_type: "image/png",
    };
  } catch {
    return null;
  }
}

async function deliverRecall(body, openReview = true) {
  const { status, json } = await api("POST", "/desktop/recall", body, { retries: 2 });
  if (status >= 400) {
    throw new Error(
      (typeof json.detail === "string" && json.detail) || json.error || "recall failed"
    );
  }
  const queuedItems = json.queued || [];
  const first = queuedItems[0];
  showCaptureHud({
    kicker: "Recall",
    title: first?.title || "Related chats",
    body: (json.summary || first?.body || "").slice(0, 160),
    app: "Residence",
    method: body.image_base64 ? "image-recall" : "text-recall",
    queued: queuedItems.length,
  });
  if (first && openReview) {
    pendingInbox = queuedItems;
    inboxIndex = 0;
    openPermission(decoratePermission(first, 0, queuedItems.length));
  }
  await pollPending(true);
  return json;
}

async function recallClipboardImage() {
  const payload = clipboardImagePayload();
  if (!payload) {
    showNote("Residence", "Copy an image first, then try again.", { force: true });
    return;
  }
  showCaptureHud({
    kicker: "Recall",
    title: "Looking up related chats…",
    body: "Captioning image, then searching Claude/GPT memory.",
    app: "Clipboard",
    method: "image-recall",
  });
  try {
    await deliverRecall({ ...payload, source: "macos", text: "", use_llm: true });
  } catch (e) {
    showNote("Residence", String(e.message || e), { force: true });
  }
}

async function captureSmart() {
  try {
    // Always attempt a real front-app capture. The TCC API often returns false
    // after a re-sign even when Accessibility is ON — gating on it left users
    // with an empty composer and nothing from the app they were in.
    //
    // Hide the pill first so we are not the frontmost process, then let
    // smartCapture re-activate the last external app (Chrome, WhatsApp, …).
    if (statusWin && !statusWin.isDestroyed() && statusWin.isVisible()) {
      statusWin.hide();
      await new Promise((r) => setTimeout(r, 120));
    } else {
      await new Promise((r) => setTimeout(r, 60));
    }

    // Image on clipboard → related Claude/GPT chat recall
    const imagePayload = clipboardImagePayload();
    const result = await mac.smartCapture(clipboard);
    lastCaptureMeta = result;
    const settings = loadSettings();

    if (imagePayload && !result.text) {
      showCaptureHud({
        kicker: "Recall",
        title: "Image captured",
        body: "Finding related Claude/GPT chats…",
        app: result.appName || "Clipboard",
        method: "image-recall",
      });
      await deliverRecall({
        ...imagePayload,
        source: result.source || "macos",
        text: "",
        use_llm: true,
      });
      return;
    }

    const policyId = integrationPolicyId(result);
    if (settings.enabled[policyId] === false || settings.capturePolicies?.[policyId] === "off") {
      showNote("Residence", `${result.appName} capture is disabled in Integrations.`, {
        force: true,
      });
      return;
    }
    if (!result.text) {
      // Text empty but image present (selection failed) — still try recall
      if (imagePayload) {
        await deliverRecall({
          ...imagePayload,
          source: result.source || "macos",
          text: "",
          use_llm: true,
        });
        return;
      }
      // If we couldn't even leave Residence, Accessibility is almost certainly
      // the blocker — tip without trapping the UI.
      if (!hasAccessibility() || mac.isSelfApp?.(result.appName)) {
        ensureAccessibility({ reason: "capture-empty", openSettings: false });
      }
      showToast({
        kicker: "Nothing selected",
        title: `No text found in ${result.appName || "the front app"}`,
        body: "Select some text in that app, or type it here to save.",
        tone: "warn",
      });
      openComposer({
        text: "",
        appName: result.appName,
        source: result.source || "macos",
        method: "manual",
        title: `Nothing selected in ${result.appName || "front app"}`,
      });
      return;
    }

    // Text recall ask → related chats (optionally with clipboard image as cue)
    if (
      /what did (we|i) (talk|discuss|say|chat)|related chats?|from (claude|chatgpt|gpt)/i.test(
        result.text
      )
    ) {
      await deliverRecall({
        ...(imagePayload || {}),
        text: result.text,
        source: result.source || "macos",
        use_llm: true,
      });
      return;
    }
    showCaptureHud({
      kicker: "Listening",
      title: `From ${result.appName}`,
      body: (result.text || "").slice(0, 120),
      app: result.appName,
      method: result.method || "smart",
    });
    if (settings.confirmCapture === true) {
      openComposer({
        text: result.text,
        appName: result.appName,
        source: result.source,
        method: result.method,
        kind: result.kind,
        title: `Capture from ${result.appName}?`,
      });
      return;
    }
    await postCapture(result.text, result.source, result);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e).toLowerCase();
    if (msg.includes("not allowed") || msg.includes("accessibility")) {
      ensureAccessibility({ reason: "capture-error" });
      return;
    }
    if (msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("offline")) {
      showToast({
        kicker: "Offline",
        title: "Capture queued — Core is unreachable",
        body: "It sends itself as soon as Core is back on :8700.",
        tone: "warn",
        ms: 8000,
      });
      notifyOffline();
      return;
    }
    showToast({
      kicker: "Capture failed",
      title: String(e.message || e).slice(0, 120),
      tone: "error",
      ms: 8000,
    });
  }
}

async function captureClipboard() {
  const text = (clipboard.readText() || "").trim();
  if (!text) {
    showNote("Residence", "Clipboard is empty.", { force: true });
    return;
  }
  let source = "clipboard";
  let appName = "Clipboard";
  try {
    appName = await mac.frontmostApp();
    source = mac.sourceFromApp(appName);
  } catch {
    /* ignore */
  }
  const settings = loadSettings();
  if (settings.enabled[source] === false || settings.capturePolicies?.[source] === "off") {
    showNote("Residence", `${source} capture is disabled in Integrations.`, { force: true });
    return;
  }
  if (settings.confirmCapture === true) {
    openComposer({
      text,
      appName,
      source,
      method: "clipboard",
      title: "Send clipboard to Residence?",
    });
    return;
  }
  try {
    await postCapture(text, source, { method: "clipboard", appName });
  } catch (e) {
    console.error(e);
    notifyOffline();
  }
}

async function pollPending(forceNotify = false) {
  let datahubOk = true;
  try {
    // Prefer /ready (Core+DataHub). Fall back to /alive so tray stays honest if GMS flaps.
    let health;
    try {
      health = await api("GET", "/ready");
    } catch {
      health = await api("GET", "/alive");
    }
    const coreAlive = health.status < 500 && health.json?.core !== false;
    datahubOk = !!health.json?.datahub && health.json?.ok !== false;
    coreOk = !!coreAlive;
    if (coreOk && consecutiveCoreFails > 0) {
      showNote("Residence", datahubOk ? "Core reconnected." : "Core up · DataHub still down", {
        force: true,
      });
      fileLog("core reconnected datahub=" + datahubOk);
    }
    consecutiveCoreFails = 0;
    if (pollMs !== POLL_MS_OK) {
      pollMs = POLL_MS_OK;
      schedulePoll();
      fileLog("poll interval reset to " + pollMs);
    }
  } catch {
    coreOk = false;
    consecutiveCoreFails += 1;
    const next = Math.min(POLL_MS_MAX, POLL_MS_OK * Math.pow(2, Math.min(4, consecutiveCoreFails)));
    if (next !== pollMs) {
      pollMs = next;
      schedulePoll();
      fileLog(`poll backoff ${pollMs}ms fails=${consecutiveCoreFails}`);
    }
    if (consecutiveCoreFails === 3) {
      showNote("Residence", "Core offline — run ./scripts/residence-up.sh", { force: true });
      fileLog("core offline");
    }
    setTrayMenu();
    return;
  }
  setTrayMenu();
  await flushOutbox();

  try {
    const { json } = await api("GET", "/desktop/pending");
    const pending = json.pending || [];
    pendingInbox = pending;
    if (inboxIndex >= pending.length) inboxIndex = Math.max(0, pending.length - 1);
    // Forget items that left the queue elsewhere, otherwise this set grows for
    // the whole life of the process.
    const liveIds = new Set(pending.map((p) => p.id));
    for (const id of lastNotifiedIds) {
      if (!liveIds.has(id)) lastNotifiedIds.delete(id);
    }
    const groups = new Map();
    for (const item of pending) {
      const key = item.operationId || item.id;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }
    updateTrayBadge(pending.length);
    setTrayMenu();
    for (const items of groups.values()) {
      const item = items[0];
      if (lastNotifiedIds.has(item.id)) continue;
      lastNotifiedIds.add(item.id);
      if (!forceNotify && inQuietHours() && item.kind !== "contradiction") continue;
      showDecisionNotification(decoratePermission(item, 0, items.length), items.length);
    }
    const settings = loadSettings();
    if (pending.length && app.dock && settings.showDock) {
      const now = Date.now();
      if (now - lastDockBounceAt > 60000) {
        app.dock.bounce("informational");
        lastDockBounceAt = now;
      }
    }
  } catch (e) {
    fileLog(`poll error ${e}`);
  }
}

function openFirstRun() {
  // No separate setup window — the pill is the only surface.
  const s = loadSettings();
  if (!s.firstRunDone) {
    s.firstRunDone = true;
    saveSettings(s);
  }
  openStatus({ activate: true, view: "actions" });
  showToast({
    kicker: "Welcome",
    title: "⌘⇧R capture · ⌘⇧I inbox",
    body: "Esc hides the pill. Click the menu-bar R to bring it back.",
    ms: 9000,
  });
  // Soft tip only — never trap first-run on the Fix bank.
  setTimeout(
    () => ensureAccessibility({ reason: "welcome", openSettings: false }),
    800
  );
}

function hasAccessibility() {
  try {
    return systemPreferences.isTrustedAccessibilityClient(false);
  } catch {
    // If the API is unavailable we cannot know — do not pretend it is granted,
    // or capture will silently fail later.
    return false;
  }
}

/** Modern System Settings deep links (Ventura → Tahoe). Legacy last. */
const ACCESSIBILITY_SETTINGS_URLS = [
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
];

let accessibilityWatchTimer = null;
let accessibilityPromptedAt = 0;
/** User dismissed the nag this session — never steal the pill away again. */
let accessibilityNagDismissed = false;

function openAccessibilitySettings({ promptApple = false } = {}) {
  // Only prompt Apple's dialog when explicitly asked. Calling prompt on every
  // toast click makes macOS look like permission is "missing" even when the
  // Accessibility toggle already shows Residence ON.
  if (promptApple) {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch {
      /* fall through */
    }
  }
  const [primary, ...fallbacks] = ACCESSIBILITY_SETTINGS_URLS;
  shell.openExternal(primary).catch(() => {
    for (const url of fallbacks) {
      shell.openExternal(url).catch((e) => {
        fileLog(`accessibility settings open failed ${url} ${e}`);
      });
    }
  });
}

/**
 * Keep watching until Accessibility is granted. Replacing Residence.app often
 * orphans the old TCC grant (Settings still shows ON, API still returns false).
 */
function watchAccessibilityUntilGranted() {
  if (accessibilityWatchTimer) return;
  accessibilityWatchTimer = setInterval(() => {
    if (hasAccessibility()) {
      clearInterval(accessibilityWatchTimer);
      accessibilityWatchTimer = null;
      accessibilityNagDismissed = false;
      fileLog("accessibility granted");
      showToast({
        kicker: "Ready",
        title: "Accessibility allowed",
        body: "⌘⇧R can now read the front app.",
        ms: 5000,
      });
      setTrayMenu();
      if (statusWin && !statusWin.isDestroyed()) {
        statusWin.webContents.send("status-refresh", { at: Date.now() });
      }
    }
  }, 1500);
}

/**
 * Soft Accessibility hint. Never hijacks the pill onto Fix — that was locking
 * users out of every feature when macOS still returned false after a re-sign
 * even though Settings already showed Residence as allowed.
 *
 * @param {{reason?: string, openSettings?: boolean, force?: boolean}} opts
 */
function ensureAccessibility({
  reason = "capture",
  openSettings = false,
  force = false,
} = {}) {
  if (hasAccessibility()) return true;
  if (accessibilityNagDismissed && !force) {
    fileLog(`accessibility nag skipped reason=${reason}`);
    return false;
  }

  showToast({
    kicker: "Capture tip",
    title: "macOS still blocks reading apps",
    body:
      "Even if Residence looks allowed: Accessibility → Residence → OFF then ON, " +
      "then quit and reopen Residence. Other features still work — tap Continue.",
    tone: "warn",
    ms: 12000,
    fix: { label: "Open Settings", action: "open-accessibility" },
    fixSecondary: { label: "Continue", action: "dismiss-accessibility" },
  });

  const now = Date.now();
  if (openSettings && now - accessibilityPromptedAt > 8000) {
    accessibilityPromptedAt = now;
    openAccessibilitySettings({ promptApple: force || reason === "welcome" });
  }
  watchAccessibilityUntilGranted();
  fileLog(`accessibility needed reason=${reason}`);
  return false;
}

function dismissAccessibilityNag() {
  accessibilityNagDismissed = true;
  if (accessibilityWatchTimer) {
    clearInterval(accessibilityWatchTimer);
    accessibilityWatchTimer = null;
  }
  pushPill("actions", {}, { activate: true });
  showToast({
    kicker: "OK",
    title: "Continuing without app capture",
    body: "Inbox, Save, Prefs, and typed capture still work. ⌘⇧R needs the toggle refresh.",
    ms: 5000,
  });
  fileLog("accessibility nag dismissed");
  return { ok: true };
}

function requestAccessibility({ explain = false } = {}) {
  ensureAccessibility({
    reason: explain ? "explain" : "request",
    openSettings: true,
    force: true,
  });
}

function shapeWritePayload(item, writeMode, destination, extra = {}) {
  const payload = { ...(item.payload || {}) };
  payload.source = payload.source || item.source || "";
  payload.captureMethod = payload.captureMethod || item.captureMethod || "";
  payload.summary =
    payload.summary ||
    item.summary ||
    mac.summarizeContent(item.utterance || payload.text || payload.note || item.body || "");
  if (extra.personalNote) payload.personalNote = String(extra.personalNote).trim();
  const dest = String(destination || writeMode || "").toLowerCase();
  if (dest === "facts-only" || writeMode === "facts-only") {
    return { actionApp: item.actionApp, payload, skip: true, destination: "facts-only" };
  }
  if (dest === "notes" || writeMode === "notes") {
    return { actionApp: "notes", payload, destination: "notes" };
  }
  if (dest === "calendar" || writeMode === "calendar" || writeMode === "calendar-only") {
    return { actionApp: "calendar", payload, destination: "calendar" };
  }
  if (dest === "reminders" || writeMode === "reminder-only" || writeMode === "reminders") {
    if (/youtube|watch/i.test(item.title || "") || payload.q === "youtube") {
      payload.q = payload.q || "youtube";
      payload.title = payload.title || "Watch later";
    } else {
      payload.title = payload.title || item.title || "Residence reminder";
    }
    return { actionApp: "notes", payload, destination: "reminders" };
  }
  return {
    actionApp: item.actionApp,
    payload,
    destination: item.primaryDestination || null,
    skip: false,
  };
}

async function resolvePermission(id, accept, knownItem = null, opts = {}) {
  let item = knownItem;
  if (!item) {
    const cached = pendingInbox.find((p) => p.id === id);
    if (cached) item = cached;
  }
  if (!item) {
    try {
      const { json } = await api("GET", "/desktop/pending");
      item = (json.pending || []).find((p) => p.id === id) || null;
    } catch {
      /* ignore */
    }
  }
  // The write path reads whenLabel/summary, which only exist after decoration.
  // Resolving straight from the pill would otherwise drop the parsed event time.
  if (item && !item.actionOptions) item = decoratePermission(item);

  const writeMode = opts.writeMode || "full";
  const destination =
    opts.destination ||
    (writeMode === "calendar-only"
      ? "calendar"
      : writeMode === "reminder-only"
        ? "reminders"
        : writeMode === "facts-only"
          ? "facts-only"
          : writeMode === "notes"
            ? "notes"
            : null);
  const personalNote = opts.personalNote || "";
  const resolveBody = { id, accept };
  if (accept && destination && destination !== "full") {
    resolveBody.destination = destination;
  }
  const { status, json } = await api("POST", "/desktop/resolve", resolveBody, { retries: 4 });
  if (status >= 400) {
    const detail =
      (typeof json.detail === "string" && json.detail) ||
      json.error ||
      (status === 429 ? "rate_limited — Core busy, retry Save" : "save failed");
    fileLog(`resolve failed status=${status} detail=${detail}`);
    throw new Error(detail);
  }
  lastNotifiedIds.delete(id);
  const opId = item?.operationId;
  pendingInbox = pendingInbox.filter((p) => p.id !== id);

  // One choice finishes the capture — dismiss sibling suggestions for same capture.
  if (accept && opId) {
    const siblings = pendingInbox.filter((p) => p.operationId === opId);
    pendingInbox = pendingInbox.filter((p) => p.operationId !== opId);
    for (const sib of siblings) {
      lastNotifiedIds.delete(sib.id);
      try {
        await api("POST", "/desktop/resolve", { id: sib.id, accept: false }, { retries: 1 });
      } catch (e) {
        fileLog(`sibling decline failed ${e}`);
      }
    }
  }

  let writeMsg = "";
  const settings = loadSettings();
  const policy = writePolicyForItem(item);
  const shaped = shapeWritePayload(item || {}, writeMode, destination, { personalNote });
  const canWrite =
    accept &&
    settings.writeBack !== false &&
    policy !== "off" &&
    !shaped.skip &&
    shaped.destination !== "facts-only" &&
    writeMode !== "facts-only";

  if (canWrite && item) {
    const wb = await mac.writeBack(
      shaped.actionApp || item.actionApp,
      shaped.payload || item.payload || {},
      item.utterance || "",
      item.operationId || id,
      {
        destination: shaped.destination || destination,
        source: item.source,
        captureMethod: item.captureMethod,
        personalNote,
        intentTitle: item.title || shaped.payload?.title || "",
        whenLabel: item.whenLabel || shaped.payload?.whenLabel || "",
      }
    );
    if (wb.ok && wb.writes?.length) {
      writeMsg =
        " · also " + wb.writes.map((w) => w.app).filter(Boolean).join(", ");
    } else if (!wb.ok) {
      writeMsg = ` · Mac write-back failed (${wb.error || "permission"})`;
      const retries = loadWritebackRetries();
      retries.unshift({
        permissionId: id,
        operationId: item.operationId || id,
        actionApp: shaped.actionApp || item.actionApp,
        payload: shaped.payload || item.payload || {},
        utterance: item.utterance || "",
        createdAt: Date.now(),
        attempts: 0,
        lastError: wb.error || "native write-back failed",
      });
      saveWritebackRetries(retries);
    }
    try {
      await api("POST", "/desktop/writeback-result", {
        operation_id: item.operationId || id,
        permission_id: id,
        ok: !!wb.ok,
        writes: wb.writes || [],
        error: wb.error || null,
      });
    } catch (e) {
      fileLog(`writeback audit failed ${e}`);
    }
  } else if (accept && writeMode === "facts-only") {
    writeMsg = " · Facts only (skipped Mac write)";
  }

  if (accept && json.factId) {
    acceptStack.unshift({
      factId: json.factId,
      permissionId: id,
      operationId: item?.operationId || id,
      title: item?.title || item?.payload?.title || "Fact",
      at: Date.now(),
    });
    acceptStack = acceptStack.slice(0, 8);
  }

  if (accept) {
    flashSaved({
      title: item?.title || "Saved",
      body: writeMsg ? `Shared context updated${writeMsg}` : "Added to your shared context",
    });
  } else {
    showToast({
      kicker: "Not saved",
      title: item?.title || "Skipped",
      body: "Nothing changed in your shared context.",
    });
  }
  await pollPending(true);
  if (pendingInbox.length) {
    inboxShowCurrent({ activate: false });
  } else {
    pushPill("actions", {});
  }
  return { ...json, writeBack: writeMsg, advanced: true };
}

const briefingStatePath = () =>
  path.join(app.getPath("userData"), "briefing-state.json");

let briefingWatchTimer = null;

async function syncAppleCalendar({ notify = false, proposeImports = true } = {}) {
  let events = [];
  try {
    events = await mac.listCalendarEvents({ days: 7 });
  } catch (e) {
    fileLog(`calendar list failed ${e}`);
  }
  try {
    const { json } = await api("POST", "/desktop/calendar-sync", {
      events,
      propose_imports: proposeImports,
      source: "apple-calendar-sync",
    });
    if (notify) {
      const sync = json.sync || {};
      const clashes = (sync.clashes || []).length;
      showNote(
        "Residence · Calendar",
        `${events.length} event(s) · ${sync.proposed || 0} import Accept(s)` +
          (clashes ? ` · ${clashes} clash` : "") +
          (sync.proposed ? " · ⌘⇧I to review" : ""),
        { force: true }
      );
    }
    await pollPending(true);
    return json;
  } catch (e) {
    if (notify) showNote("Residence", "Calendar sync needs Core on :8700", { force: true });
    fileLog(`calendar sync failed ${e}`);
    return null;
  }
}

async function runMorningBriefing({ force = false } = {}) {
  const settings = loadSettings();
  if (!force && settings.morningBriefing === false) return null;
  const today = new Date().toISOString().slice(0, 10);
  const state = readJson(briefingStatePath(), {});
  if (!force && state.lastDay === today) return state.lastBriefing || null;
  if (!force && inQuietHours()) return null;

  const syncJson = await syncAppleCalendar({ notify: false, proposeImports: true });
  let briefing = syncJson?.briefing;
  if (!briefing) {
    try {
      const { json } = await api("GET", "/desktop/briefing");
      briefing = json;
    } catch (e) {
      fileLog(`briefing failed ${e}`);
      if (force) showNote("Residence", "Briefing needs Core on :8700", { force: true });
      return null;
    }
  }

  writeJson(briefingStatePath(), {
    lastDay: today,
    lastAt: Date.now(),
    lastBriefing: {
      headline: briefing.headline,
      summary: briefing.summary,
      pendingCount: briefing.pendingCount,
      clashes: (briefing.clashes || []).length,
    },
  });

  const clashN = (briefing.clashes || []).length;
  const body =
    (briefing.summary || "").split("\n").slice(0, 4).join(" · ") ||
    "Capture with ⌘⇧R when plans change";
  showNote(
    "Residence · Today",
    `${briefing.headline || "Today"}${clashN ? ` · ${clashN} clash` : ""}\n${body}`,
    { force: true }
  );
  await pollPending(true);
  return briefing;
}

function scheduleMorningBriefing() {
  if (briefingWatchTimer) {
    clearInterval(briefingWatchTimer);
    briefingWatchTimer = null;
  }
  if (loadSettings().morningBriefing === false) return;
  // Check every 10 minutes once quiet hours end / day rolls
  briefingWatchTimer = setInterval(() => {
    runMorningBriefing({ force: false }).catch(() => {});
  }, 10 * 60 * 1000);
  // Soft kick shortly after boot (skip if still quiet)
  setTimeout(() => {
    runMorningBriefing({ force: false }).catch(() => {});
  }, 12_000);
}

async function collectDiagnostics() {
  const rows = [];
  const mark = (ok) => (ok ? "OK  " : "FAIL");

  let coreDetail = "unreachable";
  let coreUp = false;
  let datahub = false;
  try {
    const { status, json } = await api("GET", "/ready");
    coreUp = status < 500 && json?.core !== false;
    datahub = !!json?.datahub;
    coreDetail = `${CORE} · datahub=${datahub ? "up" : "down"}`;
  } catch (e) {
    coreDetail = `${CORE} · ${String(e.message || e)}`;
  }
  rows.push([mark(coreUp), "Core API", coreDetail]);
  rows.push([
    mark(datahub),
    "DataHub",
    datahub ? "reachable via Core" : "Core cannot reach GMS — Accept will fail",
  ]);

  const ax = hasAccessibility();
  rows.push([
    mark(ax),
    "Accessibility",
    ax ? "granted — ⌘⇧R can read the front app" : "missing — capture from apps will not work",
  ]);

  rows.push([
    mark(failedHotkeys.length === 0),
    "Hotkeys",
    failedHotkeys.length ? `conflict: ${failedHotkeys.join(", ")}` : "all 6 registered",
  ]);

  rows.push([
    mark(Notification.isSupported()),
    "Notifications",
    Notification.isSupported() ? "available" : "unsupported on this Mac",
  ]);

  const outbox = loadOutbox();
  const retries = loadWritebackRetries();
  rows.push([
    mark(outbox.length === 0),
    "Capture outbox",
    outbox.length ? `${outbox.length} queued (Core was offline)` : "empty",
  ]);
  rows.push([
    mark(retries.length === 0),
    "Write-back queue",
    retries.length ? `${retries.length} failed write(s) to retry` : "empty",
  ]);

  return rows;
}

async function showDiagnostics() {
  showToast({ kicker: "Diagnostics", title: "Running checks…", ms: 8000 });
  const rows = await collectDiagnostics();
  const failures = rows.filter(([status]) => status.startsWith("FAIL"));
  const detail = rows.map(([status, name, note]) => `${status}  ${name} — ${note}`).join("\n");
  fileLog(`diagnostics\n${detail}`);
  const { response } = await dialog.showMessageBox({
    type: failures.length ? "warning" : "info",
    title: "Residence diagnostics",
    message: failures.length
      ? `${failures.length} check${failures.length > 1 ? "s" : ""} need attention`
      : "Everything checks out",
    detail,
    buttons: failures.length ? ["Close", "Copy report", "Open log"] : ["Close", "Copy report"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) clipboard.writeText(detail);
  if (response === 2) shell.showItemInFolder(logPath());
  showToast({
    kicker: "Diagnostics",
    title: failures.length ? `${failures.length} issue(s)` : "All clear",
    tone: failures.length ? "warn" : "info",
  });
}

function handleProtocolUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "residence:") return;
    const host = u.hostname || u.pathname.replace(/^\//, "");
    if (host === "capture") captureSmart();
    else if (host === "inbox") openInbox();
    else if (host === "status") openStatus();
    else if (host === "briefing") runMorningBriefing({ force: true });
    else if (host === "calendar" || host === "sync")
      syncAppleCalendar({ notify: true });
    else if (host === "phone") shell.openExternal("http://localhost:5173/");
  } catch (e) {
    fileLog(`protocol parse failed ${e}`);
  }
}

function registerIpc() {
  ipcMain.handle("resolve", async (_e, { id, accept, writeMode, destination, personalNote }) =>
    resolvePermission(id, accept, null, {
      writeMode: writeMode || (accept ? destination || "full" : "facts-only"),
      destination: destination || null,
      personalNote: personalNote || "",
    })
  );

  ipcMain.handle("close-permission", () => {
    pushPill("actions", {});
  });
  ipcMain.handle("hide-pill", () => {
    hideStatus();
    return { ok: true };
  });
  ipcMain.handle("pill-resize", (_e, bank) => {
    sizePill(bank);
    return { ok: true };
  });

  ipcMain.handle("get-status", async () => {
    let frontmost = "—";
    try {
      frontmost = await mac.frontmostApp();
    } catch {
      /* ignore */
    }
    const settings = loadSettings();
    let accessibility = "unknown";
    try {
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        accessibility = "granted";
      } else if (accessibilityNagDismissed) {
        // User chose Continue — do not keep a yellow Fix-bank trap.
        accessibility = "dismissed";
      } else {
        accessibility = "needs_action";
      }
    } catch {
      /* macOS only API */
    }
    return {
      coreOk,
      coreUrl: CORE,
      frontmost,
      lastCapture: lastCaptureMeta,
      outbox: loadOutbox().map(({ text, ...row }) => row),
      writebackRetries: loadWritebackRetries().map(({ utterance, ...row }) => row),
      integrations: mac.INTEGRATIONS.map((i) => ({
        ...i,
        enabled: settings.enabled[i.id] !== false,
      })),
      writeBack: settings.writeBack !== false,
      capturePolicies: settings.capturePolicies || {},
      writeBackPolicies: settings.writeBackPolicies || {},
      prefs: {
        confirmCapture: settings.confirmCapture === true,
        openAtLogin: !!settings.openAtLogin,
        showDock: !!settings.showDock,
        quietHours: !!settings.quietHours?.enabled,
      },
      acceptStack: acceptStack.map(({ factId, title, at }) => ({ factId, title, at })),
      lastAccept: acceptStack[0] || null,
      pendingCount,
      failedHotkeys,
      quietNow: inQuietHours(),
      permissions: {
        notifications: Notification.isSupported() ? "available" : "unsupported",
        accessibility,
        automation: "prompted_on_first_write",
      },
    };
  });

  ipcMain.handle("capture-smart", () => captureSmart());
  ipcMain.handle("open-inbox", () => openInbox());
  ipcMain.handle("inbox-nav", (_e, dir) => {
    if (!pendingInbox.length) return { ok: false };
    if (dir === "next") inboxIndex = Math.min(pendingInbox.length - 1, inboxIndex + 1);
    if (dir === "prev") inboxIndex = Math.max(0, inboxIndex - 1);
    inboxShowCurrent();
    return { ok: true, index: inboxIndex, total: pendingInbox.length };
  });
  ipcMain.handle("inbox-decline-rest", async () => {
    const rest = pendingInbox.slice();
    for (const item of rest) {
      try {
        await resolvePermission(item.id, false, item, {
          writeMode: "facts-only",
          skipWriteConfirm: true,
        });
      } catch (e) {
        fileLog(`decline-rest failed ${e}`);
      }
    }
    return { ok: true };
  });
  ipcMain.handle("composer-send", async (_e, text) => {
    const draft = composerDraft || lastCaptureMeta || { source: "macos", method: "composer" };
    const clean = String(text || "").trim();
    if (!clean) throw new Error("empty capture");
    await postCapture(clean, draft.source || "macos", {
      ...draft,
      method: draft.method || "composer",
      text: clean,
    });
    return { ok: true };
  });
  ipcMain.handle("composer-cancel", () => {
    showToast({ kicker: "Discarded", title: "Draft cleared" });
    pushPill("actions", {});
    return { ok: true };
  });
  ipcMain.handle("retry-writeback", async (_e, operationId) => {
    const rows = loadWritebackRetries();
    const row = rows.find((r) => r.operationId === operationId);
    if (!row) throw new Error("write-back retry not found");
    const wb = await mac.writeBack(
      row.actionApp,
      row.payload || {},
      row.utterance || "",
      row.operationId
    );
    row.attempts = (row.attempts || 0) + 1;
    if (wb.ok) {
      saveWritebackRetries(rows.filter((r) => r.operationId !== operationId));
    } else {
      row.lastError = wb.error || "native write-back failed";
      saveWritebackRetries(rows);
    }
    try {
      await api("POST", "/desktop/writeback-result", {
        operation_id: row.operationId,
        permission_id: row.permissionId,
        ok: !!wb.ok,
        writes: wb.writes || [],
        error: wb.error || null,
      });
    } catch (e) {
      fileLog(`writeback retry audit failed ${e}`);
    }
    return wb;
  });
  ipcMain.handle("set-policy", (_e, { kind, id, value }) => {
    if (!["capturePolicies", "writeBackPolicies"].includes(kind)) {
      throw new Error("invalid policy kind");
    }
    const s = loadSettings();
    s[kind] = s[kind] || {};
    s[kind][id] = value;
    saveSettings(s);
    setTrayMenu();
    return s[kind];
  });
  ipcMain.handle("set-pref", (_e, { key, value }) => {
    const allowed = ["confirmCapture", "openAtLogin", "showDock", "quietHours"];
    if (!allowed.includes(key)) throw new Error("invalid pref");
    const s = loadSettings();
    if (key === "quietHours") {
      s.quietHours = {
        ...(s.quietHours || { startHour: 22, endHour: 8 }),
        enabled: !!value,
      };
    } else {
      s[key] = value;
    }
    saveSettings(s);
    if (key === "openAtLogin") applyLoginItem(!!value);
    if (key === "showDock") applyDockPreference(!!value);
    setTrayMenu();
    return { ok: true };
  });
  ipcMain.handle("open-phone", () =>
    shell.openExternal("http://localhost:5173/")
  );
  ipcMain.handle("finishFirstRun", async (_e, opts = {}) => {
    const s = loadSettings();
    s.firstRunDone = true;
    if (opts.openAtLogin) {
      s.openAtLogin = true;
      applyLoginItem(true);
    }
    if (opts.quietHours) {
      s.quietHours = {
        ...(s.quietHours || { startHour: 22, endHour: 8 }),
        enabled: true,
      };
    }
    if (opts.morningBriefing !== false) s.morningBriefing = true;
    saveSettings(s);
    openStatus({ activate: true, view: "actions" });
    setTrayMenu();
    scheduleMorningBriefing();
    if (opts.importCalendar) {
      await runMorningBriefing({ force: true });
    }
    return { ok: true };
  });
  ipcMain.handle("openPrivacy", () => {
    // Open Settings only — do NOT re-enter ensureAccessibility (that used to
    // re-show the toast and trap the user in a Fix-bank loop).
    openAccessibilitySettings({ promptApple: true });
    watchAccessibilityUntilGranted();
    return { ok: true };
  });
  ipcMain.handle("open-accessibility", () => {
    openAccessibilitySettings({ promptApple: false });
    watchAccessibilityUntilGranted();
    return { ok: true };
  });
  ipcMain.handle("dismiss-accessibility", () => dismissAccessibilityNag());
  ipcMain.handle("undo-last", () => undoLastAccept());
  ipcMain.handle("fetch-activity", async () => {
    try {
      const { json } = await api("GET", "/desktop/activity?limit=12");
      return {
        ok: true,
        activity: json.activity || [],
        lastAccept: acceptStack[0] || null,
        pendingCount,
        acceptStackDepth: acceptStack.length,
      };
    } catch (e) {
      return {
        ok: false,
        activity: [],
        lastAccept: acceptStack[0] || null,
        pendingCount,
        error: String(e),
      };
    }
  });
}

app.on("second-instance", (_event, argv) => {
  const url = argv.find((a) => String(a).startsWith("residence://"));
  if (url) handleProtocolUrl(url);
  else openInbox();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

app.whenReady().then(async () => {
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allow = [
        "media",
        "microphone",
        "speechRecognition",
        "mediaKeySystem",
      ].includes(permission);
      callback(allow);
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return ["media", "microphone", "speechRecognition", "mediaKeySystem"].includes(
        permission
      );
    });
  } catch (e) {
    fileLog(`session permission handlers failed ${e}`);
  }

  if (SELFTEST) {
    const rows = await collectDiagnostics();
    const failed = rows.filter(([s]) => s.startsWith("FAIL"));
    for (const [state, name, note] of rows) {
      process.stdout.write(`${state}  ${name.padEnd(16)} ${note}\n`);
    }
    process.stdout.write(
      `\n${rows.length - failed.length}/${rows.length} checks passed\n`
    );
    app.exit(failed.length ? 1 : 0);
    return;
  }

  registerIpc();
  const settings = loadSettings();
  applyDockPreference(!!settings.showDock);
  applyLoginItem(!!settings.openAtLogin);
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("residence", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("residence");
    }
  } catch (e) {
    fileLog(`protocol register failed ${e}`);
  }

  fileLog("app start agent-mode");

  tray = new Tray(trayIcon(0));
  setTrayMenu();
  tray.on("click", () => tray.popUpContextMenu());
  tray.on("right-click", () => tray.popUpContextMenu());
  tray.on("double-click", () => openInbox());

  failedHotkeys = [];
  const hotkeys = [
    [HOTKEY, () => captureSmart()],
    [HOTKEY_CLIP, () => captureClipboard()],
    [HOTKEY_ACCEPT, () => resolveTopPending(true)],
    [HOTKEY_DECLINE, () => resolveTopPending(false)],
    [HOTKEY_UNDO, () => undoLastAccept()],
    [HOTKEY_INBOX, () => openInbox()],
  ];
  for (const [combo, fn] of hotkeys) {
    if (!globalShortcut.register(combo, fn)) {
      failedHotkeys.push(combo.replace("CommandOrControl", "⌘"));
      fileLog("hotkey failed " + combo);
    }
  }
  if (failedHotkeys.length) {
    showNote(
      "Residence",
      `Hotkey conflict — could not register: ${failedHotkeys.join(", ")}`,
      { force: true }
    );
  }

  if (!settings.firstRunDone) openFirstRun();
  else openStatus({ activate: false });

  // Soft tip only after updates. Never force Fix bank — a false-negative from
  // macOS after re-signing used to lock users out of every feature.
  setTimeout(() => {
    if (!hasAccessibility()) {
      ensureAccessibility({ reason: "boot", openSettings: false });
    }
  }, 1200);

  pollPending();
  schedulePoll();
  scheduleMorningBriefing();
  // Remember which app the user is in so Capture from the pill still targets it.
  if (!frontmostTracker) frontmostTracker = mac.startFrontmostTracker(1000);

  const bootUrl = process.argv.find((a) => String(a).startsWith("residence://"));
  if (bootUrl) handleProtocolUrl(bootUrl);

  showNote(
    "Residence",
    "Menu-bar agent · ⌘⇧R capture · ⌘⇧I inbox"
  );
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
  if (briefingWatchTimer) clearInterval(briefingWatchTimer);
  if (frontmostTracker) {
    clearInterval(frontmostTracker);
    frontmostTracker = null;
  }
  if (accessibilityWatchTimer) {
    clearInterval(accessibilityWatchTimer);
    accessibilityWatchTimer = null;
  }
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});
