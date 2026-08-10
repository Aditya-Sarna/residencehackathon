const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("residence", {
  onPermission: (cb) => {
    ipcRenderer.on("permission", (_e, item) => cb(item));
  },
  onHud: (cb) => {
    ipcRenderer.on("hud", (_e, payload) => cb(payload));
  },
  onComposer: (cb) => {
    ipcRenderer.on("composer", (_e, payload) => cb(payload));
  },
  onStatus: (cb) => {
    ipcRenderer.on("status-refresh", (_e, payload) => cb(payload));
  },
  resolve: (id, accept, writeMode, destination) =>
    ipcRenderer.invoke("resolve", {
      id,
      accept,
      writeMode,
      destination: destination || writeMode || null,
    }),
  close: () => ipcRenderer.invoke("close-permission"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  captureSmart: () => ipcRenderer.invoke("capture-smart"),
  retryWriteback: (operationId) => ipcRenderer.invoke("retry-writeback", operationId),
  setPolicy: (kind, id, value) => ipcRenderer.invoke("set-policy", { kind, id, value }),
  setPref: (key, value) => ipcRenderer.invoke("set-pref", { key, value }),
  undoLast: () => ipcRenderer.invoke("undo-last"),
  openPhone: () => ipcRenderer.invoke("open-phone"),
  finishFirstRun: (opts) => ipcRenderer.invoke("finishFirstRun", opts || {}),
  openPrivacy: () => ipcRenderer.invoke("openPrivacy"),
  fetchActivity: () => ipcRenderer.invoke("fetch-activity"),
  composerSend: (text) => ipcRenderer.invoke("composer-send", text),
  composerCancel: () => ipcRenderer.invoke("composer-cancel"),
  inboxNav: (dir) => ipcRenderer.invoke("inbox-nav", dir),
  inboxDeclineRest: () => ipcRenderer.invoke("inbox-decline-rest"),
  openInbox: () => ipcRenderer.invoke("open-inbox"),
});
