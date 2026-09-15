import type { ModelRow, ModelVariantRow, WorkspaceRow, ProjectRow, GenerationRow } from "./db";

declare global {
  interface Window {
    kwesi?: {
      openExternal: (url: string) => Promise<boolean>;
      getEnv: () => Promise<Record<string, string | number>>;
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
