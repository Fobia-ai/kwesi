import type {
  ModelRow,
  ModelVariantRow,
  WorkspaceRow,
  ProjectRow,
  GenerationRow,
  TrainingRunRow,
  TrainedModelRow,
} from "./db";

declare global {
  interface Window {
    kwesi?: {
      openExternal: (url: string) => Promise<boolean>;
      getEnv: () => Promise<Record<string, string | number>>;
      // Synchronous — see electron/preload.ts's comment on why this doesn't
      // need ipcRenderer.invoke. Returns "" if the given File wasn't really
      // backed by a file on disk (e.g. constructed in JS), same as
      // webUtils.getPathForFile's own documented behavior.
      getFilePathForUpload: (file: File) => string;
      db: {
        listModels: () => Promise<ModelRow[]>;
        listModelVariants: (modelId: string) => Promise<ModelVariantRow[]>;
        listWorkspaces: () => Promise<WorkspaceRow[]>;
        createWorkspace: (name: string, modelId: string) => Promise<WorkspaceRow>;
        deleteWorkspace: (id: string, deleteFiles: boolean) => Promise<void>;
        listProjects: (workspaceId: string) => Promise<ProjectRow[]>;
        createProject: (workspaceId: string, name: string) => Promise<ProjectRow>;
        deleteProject: (id: string, deleteFiles: boolean) => Promise<void>;
        listGenerations: (projectId: string) => Promise<GenerationRow[]>;
        createPlaceholderGeneration: (
          projectId: string,
          checkpointVariant?: string,
        ) => Promise<GenerationRow>;
        deleteGeneration: (id: string, deleteFiles: boolean) => Promise<void>;
      };
      models: {
        install: (modelId: string, variantName: string) => Promise<{ ok: boolean; reason?: string }>;
        retry: (modelId: string, variantName: string) => Promise<{ ok: boolean; reason?: string }>;
        cancel: (variantId: string) => Promise<boolean>;
        remove: (modelId: string, variantName: string) => Promise<{ ok: boolean; reason?: string }>;
        listQueue: () => Promise<(ModelVariantRow & { model_display_name: string })[]>;
        workspacesUsingModel: (modelId: string) => Promise<{ id: string; name: string }[]>;
        diskFreeBytes: () => Promise<number | null>;
        onProgress: (callback: (event: unknown) => void) => () => void;
      };
      generation: {
        submit: (
          projectId: string,
          checkpointVariant: string | null,
          inputParams: Record<string, unknown>,
          outputKind: string,
        ) => Promise<{ ok: boolean; reason?: string; generation?: GenerationRow }>;
        startServer: (modelId: string) => Promise<void>;
        stopServer: (modelId: string) => Promise<void>;
        serverStatus: (modelId: string) => Promise<string>;
        onProgress: (callback: (event: unknown) => void) => () => void;
      };
      audio: {
        stat: (filePath: string) => Promise<{ exists: boolean; sizeBytes: number }>;
        read: (filePath: string) => Promise<{
          ok: boolean;
          bytes?: Uint8Array;
          mimeType?: string;
          reason?: string;
        }>;
        save: (
          filePath: string,
          suggestedName: string,
          kind: "export" | "download",
        ) => Promise<{ ok: boolean; path?: string; reason?: string }>;
        reveal: (filePath: string) => Promise<{ ok: boolean }>;
      };
      hardware: {
        gpuVram: () => Promise<{
          available: boolean;
          totalVramGb: number;
          freeVramGb: number;
          gpuName?: string;
        }>;
      };
      training: {
        submit: (params: {
          modelId: string;
          baseCheckpointVariant: string | null;
          runName: string;
          datasetFiles: string[];
          allowedExtensions: string[];
          hyperparams: Record<string, unknown>;
          outputDir: string;
          datasetCaptions?: Record<string, string>;
        }) => Promise<{ ok: boolean; reason?: string; trainingRun?: TrainingRunRow }>;
        list: (modelId?: string) => Promise<TrainingRunRow[]>;
        get: (runId: string) => Promise<TrainingRunRow | null>;
        cancel: (runId: string) => Promise<boolean>;
        listTrainedModels: (modelId?: string) => Promise<TrainedModelRow[]>;
        pickOutputDir: (modelId: string, runName: string) => Promise<{ ok: boolean; path?: string }>;
        defaultOutputDir: (modelId: string, runName: string) => Promise<string>;
        pickDatasetDir: () => Promise<{ ok: boolean; path?: string }>;
        onProgress: (callback: (event: unknown) => void) => () => void;
      };
      security: {
        hasPasscode: () => Promise<boolean>;
        setPasscode: (passcode: string) => Promise<{ ok: boolean; reason?: string }>;
        removePasscode: () => Promise<void>;
        verifyPasscode: (attempt: string) => Promise<boolean>;
        getIdleTimeoutMinutes: () => Promise<number>;
        setIdleTimeoutMinutes: (minutes: number) => Promise<void>;
      };
      profile: {
        get: () => Promise<{ display_name: string | null; email: string | null; avatar_path: string | null }>;
        save: (displayName: string | null, email: string | null) => Promise<void>;
      };
      artistProfiles: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            bio: string | null;
            avatar_path: string | null;
            genres: string;
            languages: string;
            created_at: number;
            updated_at: number;
          }>
        >;
        create: (
          name: string,
          bio: string | null,
          genres: string[],
          languages: string[],
        ) => Promise<{
          id: string;
          name: string;
          bio: string | null;
          avatar_path: string | null;
          genres: string;
          languages: string;
          created_at: number;
          updated_at: number;
        }>;
        update: (
          id: string,
          name: string,
          bio: string | null,
          genres: string[],
          languages: string[],
        ) => Promise<void>;
        delete: (id: string) => Promise<void>;
        setAvatar: (id: string, sourcePath: string) => Promise<{ ok: boolean; avatarPath?: string; reason?: string }>;
        removeAvatar: (id: string) => Promise<void>;
        readAvatar: (
          avatarPath: string,
        ) => Promise<{ ok: boolean; bytes?: Uint8Array; mimeType?: string; reason?: string }>;
      };
      crashLog: {
        report: (
          kind: "window-error" | "unhandledrejection",
          message: string,
          stack?: string,
          extra?: Record<string, unknown>,
        ) => Promise<void>;
      };
    };
  }
}

/**
 * Opens an external link. Goes through the Electron preload bridge (which
 * only allows allowlisted URLs) when running inside the app; falls back to
 * a plain new-tab open when running in a plain browser during UI dev.
 */
export async function openExternal(url: string): Promise<void> {
  if (window.kwesi) {
    await window.kwesi.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export {};
