import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("kwesi", {
  openExternal: (url: string) => ipcRenderer.invoke("kwesi:open-external", url),
  getEnv: () => ipcRenderer.invoke("kwesi:get-env"),
  // Electron 32+'s replacement for the removed `file.path` property.
  // webUtils only runs in a context with a real reference to the renderer's
  // File object, which a contextBridge-exposed function gets directly (the
  // File is structured-cloneable across the bridge) — no IPC round-trip
  // needed, this returns synchronously. See DynamicGenerationForm.tsx's
  // audio_upload/midi_upload handling for the real consumer.
  getFilePathForUpload: (file: File) => webUtils.getPathForFile(file),
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
    listAllGenerations: () => ipcRenderer.invoke("kwesi:db:generations:listAll"),
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
    cancel: (generationId: string) => ipcRenderer.invoke("kwesi:generation:cancel", generationId),
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on("kwesi:generation:progress", listener);
      return () => ipcRenderer.removeListener("kwesi:generation:progress", listener);
    },
  },
  audio: {
    stat: (filePath: string) => ipcRenderer.invoke("kwesi:audio:stat", filePath),
    read: (filePath: string) => ipcRenderer.invoke("kwesi:audio:read", filePath),
    save: (filePath: string, suggestedName: string, kind: "export" | "download") =>
      ipcRenderer.invoke("kwesi:audio:save", filePath, suggestedName, kind),
    reveal: (filePath: string) => ipcRenderer.invoke("kwesi:audio:reveal", filePath),
  },
  hardware: {
    gpuVram: () => ipcRenderer.invoke("kwesi:hardware:gpuVram"),
  },
  training: {
    submit: (params: unknown) => ipcRenderer.invoke("kwesi:training:submit", params),
    list: (modelId?: string) => ipcRenderer.invoke("kwesi:training:list", modelId),
    get: (runId: string) => ipcRenderer.invoke("kwesi:training:get", runId),
    cancel: (runId: string) => ipcRenderer.invoke("kwesi:training:cancel", runId),
    listTrainedModels: (modelId?: string) => ipcRenderer.invoke("kwesi:training:listTrainedModels", modelId),
    pickOutputDir: (modelId: string, runName: string) =>
      ipcRenderer.invoke("kwesi:training:pickOutputDir", modelId, runName),
    pickDatasetDir: () => ipcRenderer.invoke("kwesi:training:pickDatasetDir"),
    defaultOutputDir: (modelId: string, runName: string) =>
      ipcRenderer.invoke("kwesi:training:defaultOutputDir", modelId, runName),
    onProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on("kwesi:training:progress", listener);
      return () => ipcRenderer.removeListener("kwesi:training:progress", listener);
    },
  },
  security: {
    hasPasscode: () => ipcRenderer.invoke("kwesi:security:hasPasscode"),
    setPasscode: (passcode: string) => ipcRenderer.invoke("kwesi:security:setPasscode", passcode),
    removePasscode: () => ipcRenderer.invoke("kwesi:security:removePasscode"),
    verifyPasscode: (attempt: string) => ipcRenderer.invoke("kwesi:security:verifyPasscode", attempt),
    getIdleTimeoutMinutes: () => ipcRenderer.invoke("kwesi:security:getIdleTimeoutMinutes"),
    setIdleTimeoutMinutes: (minutes: number) =>
      ipcRenderer.invoke("kwesi:security:setIdleTimeoutMinutes", minutes),
  },
  profile: {
    get: () => ipcRenderer.invoke("kwesi:profile:get"),
    save: (displayName: string | null, email: string | null) =>
      ipcRenderer.invoke("kwesi:profile:save", displayName, email),
  },
  artistProfiles: {
    list: () => ipcRenderer.invoke("kwesi:artistProfiles:list"),
    create: (name: string, bio: string | null, genres: string[], languages: string[]) =>
      ipcRenderer.invoke("kwesi:artistProfiles:create", name, bio, genres, languages),
    update: (id: string, name: string, bio: string | null, genres: string[], languages: string[]) =>
      ipcRenderer.invoke("kwesi:artistProfiles:update", id, name, bio, genres, languages),
    delete: (id: string) => ipcRenderer.invoke("kwesi:artistProfiles:delete", id),
    setAvatar: (id: string, sourcePath: string) =>
      ipcRenderer.invoke("kwesi:artistProfiles:setAvatar", id, sourcePath),
    removeAvatar: (id: string) => ipcRenderer.invoke("kwesi:artistProfiles:removeAvatar", id),
    readAvatar: (avatarPath: string) => ipcRenderer.invoke("kwesi:artistProfiles:readAvatar", avatarPath),
  },
  crashLog: {
    report: (
      kind: "window-error" | "unhandledrejection",
      message: string,
      stack?: string,
      extra?: Record<string, unknown>,
    ) => ipcRenderer.invoke("kwesi:crashLog:report", { kind, message, stack, extra }),
  },
});
