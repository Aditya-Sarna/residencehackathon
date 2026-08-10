// Test double for preload.js. Records every bridge call and lets the harness
// push main-process events into the pill.
const { contextBridge, ipcRenderer } = require("electron");

const calls = [];
const listeners = { pill: [], toast: [], saved: [], status: [] };
let statusPayload = {
  coreOk: true,
  pendingCount: 0,
  integrations: [{ id: "notes", name: "Apple Notes", enabled: true }],
  capturePolicies: {},
  writebackRetries: [],
  prefs: { confirmCapture: false, openAtLogin: false, showDock: false, quietHours: false },
  permissions: { notifications: "available", accessibility: "granted" },
  failedHotkeys: [],
};

const record = (name, result) => (...args) => {
  calls.push({ name, args });
  return Promise.resolve(typeof result === "function" ? result(...args) : result);
};

contextBridge.exposeInMainWorld("residence", {
  onPill: (cb) => listeners.pill.push(cb),
  onToast: (cb) => listeners.toast.push(cb),
  onSaved: (cb) => listeners.saved.push(cb),
  onStatus: (cb) => listeners.status.push(cb),

  getStatus: () => {
    calls.push({ name: "getStatus", args: [] });
    return Promise.resolve(statusPayload);
  },
  resolve: record("resolve", { ok: true }),
  close: record("close", { ok: true }),
  hidePill: record("hidePill", { ok: true }),
  captureSmart: record("captureSmart", { ok: true }),
  retryWriteback: record("retryWriteback", { ok: true }),
  // These two actually mutate the mock status, like main.js persists to disk
  // and reflects back on the next getStatus() — otherwise the very next
  // refresh() in the renderer would stomp an optimistic UI update with stale
  // mock data and mask real toggle bugs.
  setPolicy: record("setPolicy", (kind, id, value) => {
    statusPayload[kind] = { ...(statusPayload[kind] || {}), [id]: value };
    return statusPayload[kind];
  }),
  setPref: record("setPref", (key, value) => {
    statusPayload.prefs = { ...(statusPayload.prefs || {}), [key]: value };
    return { ok: true };
  }),
  undoLast: record("undoLast", { ok: true }),
  openPhone: record("openPhone", { ok: true }),
  openPrivacy: record("openPrivacy", { ok: true }),
  openAccessibility: record("openAccessibility", { ok: true }),
  dismissAccessibility: record("dismissAccessibility", { ok: true }),
  fetchActivity: record("fetchActivity", { ok: true }),
  composerSend: record("composerSend", { ok: true }),
  composerCancel: record("composerCancel", { ok: true }),
  inboxNav: record("inboxNav", { ok: true }),
  inboxDeclineRest: record("inboxDeclineRest", { ok: true }),
  openInbox: record("openInbox", { ok: true }),
  pillResize: record("pillResize", { ok: true }),
});

contextBridge.exposeInMainWorld("__harness", {
  calls: () => calls.slice(),
  clearCalls: () => {
    calls.length = 0;
  },
  setStatus: (next) => {
    statusPayload = { ...statusPayload, ...next };
  },
  emit: (channel, payload) => {
    (listeners[channel] || []).forEach((cb) => cb(payload));
  },
});

ipcRenderer.on("harness-ping", () => ipcRenderer.send("harness-pong"));
