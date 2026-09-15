import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
  models: {
    install: (modelId: string, variantName: string) =>
      ipcRenderer.invoke("kwesi:models:install", modelId, variantName),
    retry: (modelId: string, variantName: string) =>
      ipcRenderer.invoke("kwesi:models:retry", modelId, variantName),
    cancel: (variantId: string) => ipcRenderer.invoke("kwesi:models:cancel", variantId),
    remove: (modelId: string, variantName: string) =>
      ipcRenderer.invoke("kwesi:models:remove", modelId, variantName),
    listQueue: () => ipcRenderer.invoke("kwesi:models:queue:list"),
    workspacesUsingModel: (modelId: string) =>
      ipcRenderer.invoke("kwesi:models:workspacesUsingModel", modelId),
    diskFreeBytes: () => ipcRenderer.invoke("kwesi:models:diskFreeBytes"),
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on("kwesi:models:progress", listener);
      return () => ipcRenderer.removeListener("kwesi:models:progress", listener);
    },
  },
  generation: {
    submit: (
      projectId: string,
      checkpointVariant: string | null,
      inputParams: Record<string, unknown>,
      outputKind: string,
    ) => ipcRenderer.invoke("kwesi:generation:submit", projectId, checkpointVariant, inputParams, outputKind),
    startServer: (modelId: string) => ipcRenderer.invoke("kwesi:generation:server:start", modelId),
    stopServer: (modelId: string) => ipcRenderer.invoke("kwesi:generation:server:stop", modelId),
    serverStatus: (modelId: string) => ipcRenderer.invoke("kwesi:generation:server:status", modelId),
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on("kwesi:generation:progress", listener);
      return () => ipcRenderer.removeListener("kwesi:generation:progress", listener);
    },
  },
});
