const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("residence", {
  onPill: (cb) => on("pill", cb),
  onToast: (cb) => on("toast", cb),
  onSaved: (cb) => on("saved", cb),
  onStatus: (cb) => on("status-refresh", cb),

  resolve: (id, accept, writeMode, destination, personalNote) =>
    ipcRenderer.invoke("resolve", {
      id,
      accept,
      writeMode,
      destination: destination || writeMode || null,
      personalNote: personalNote || "",
    }),
  close: () => ipcRenderer.invoke("close-permission"),
  hidePill: () => ipcRenderer.invoke("hide-pill"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  captureSmart: () => ipcRenderer.invoke("capture-smart"),
  retryWriteback: (operationId) => ipcRenderer.invoke("retry-writeback", operationId),
  setPolicy: (kind, id, value) => ipcRenderer.invoke("set-policy", { kind, id, value }),
  setPref: (key, value) => ipcRenderer.invoke("set-pref", { key, value }),
  undoLast: () => ipcRenderer.invoke("undo-last"),
  openPhone: () => ipcRenderer.invoke("open-phone"),
  openPrivacy: () => ipcRenderer.invoke("openPrivacy"),
  openAccessibility: () => ipcRenderer.invoke("open-accessibility"),
  dismissAccessibility: () => ipcRenderer.invoke("dismiss-accessibility"),
  fetchActivity: () => ipcRenderer.invoke("fetch-activity"),
  composerSend: (text) => ipcRenderer.invoke("composer-send", text),
  composerCancel: () => ipcRenderer.invoke("composer-cancel"),
  inboxNav: (dir) => ipcRenderer.invoke("inbox-nav", dir),
  inboxDeclineRest: () => ipcRenderer.invoke("inbox-decline-rest"),
  openInbox: () => ipcRenderer.invoke("open-inbox"),
  pillResize: (bank) => ipcRenderer.invoke("pill-resize", bank),
});
