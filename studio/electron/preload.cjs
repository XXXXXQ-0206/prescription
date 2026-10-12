// preload 用 CommonJS：Electron 的预加载脚本走 CJS 最稳
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("presc", {
  info: () => ipcRenderer.invoke("presc:info"),
  render: (source) => ipcRenderer.invoke("presc:render", { source }),
  exportDoc: (payload) => ipcRenderer.invoke("presc:export", payload),
  saveJson: (payload) => ipcRenderer.invoke("presc:saveJson", payload),
  openJson: () => ipcRenderer.invoke("presc:openJson"),
  reveal: (p) => ipcRenderer.invoke("presc:reveal", p),
  windowAction: (action) => ipcRenderer.invoke("presc:window", action),
});
