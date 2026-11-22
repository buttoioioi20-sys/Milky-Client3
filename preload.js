const { contextBridge, ipcRenderer: r } = require("electron");
contextBridge.exposeInMainWorld("api", {
  inv: (c, ...a) => r.invoke(c, ...a),
  onLog: f => r.on("log", (_, m) => f(m))
});
