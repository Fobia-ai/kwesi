import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kwesi", {
  openExternal: (url: string) => ipcRenderer.invoke("kwesi:open-external", url),
  getEnv: () => ipcRenderer.invoke("kwesi:get-env"),
});
