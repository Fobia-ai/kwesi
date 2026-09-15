import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kwesi", {
  openExternal: (url: string) => ipcRenderer.invoke("kwesi:open-external", url),
  getEnv: () => ipcRenderer.invoke("kwesi:get-env"),
  db: {
    listModels: () => ipcRenderer.invoke("kwesi:db:models:list"),
    listModelVariants: (modelId: string) =>
      ipcRenderer.invoke("kwesi:db:modelVariants:list", modelId),
    listWorkspaces: () => ipcRenderer.invoke("kwesi:db:workspaces:list"),
    createWorkspace: (name: string, modelId: string) =>
      ipcRenderer.invoke("kwesi:db:workspaces:create", name, modelId),
    deleteWorkspace: (id: string, deleteFiles: boolean) =>
      ipcRenderer.invoke("kwesi:db:workspaces:delete", id, deleteFiles),
    listProjects: (workspaceId: string) => ipcRenderer.invoke("kwesi:db:projects:list", workspaceId),
    createProject: (workspaceId: string, name: string) =>
      ipcRenderer.invoke("kwesi:db:projects:create", workspaceId, name),
    deleteProject: (id: string, deleteFiles: boolean) =>
      ipcRenderer.invoke("kwesi:db:projects:delete", id, deleteFiles),
    listGenerations: (projectId: string) =>
      ipcRenderer.invoke("kwesi:db:generations:list", projectId),
    createPlaceholderGeneration: (projectId: string, checkpointVariant?: string) =>
      ipcRenderer.invoke("kwesi:db:generations:createPlaceholder", projectId, checkpointVariant),
    deleteGeneration: (id: string, deleteFiles: boolean) =>
      ipcRenderer.invoke("kwesi:db:generations:delete", id, deleteFiles),
  },
});
