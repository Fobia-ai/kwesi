import type { EnvStatus, EnvProgress } from "./kwesiBridge";

export type { EnvStatus, EnvProgress } from "./kwesiBridge";

export interface KwesiEnvironmentApi {
  checkPrerequisites(): Promise<{
    uv: { available: boolean; version: string | null };
    git: { available: boolean; version: string | null };
    platform: string;
  }>;
  checkStatus(modelId: string): Promise<EnvStatus>;
  install(modelId: string): Promise<{ ok: boolean; reason?: string }>;
  installingModelId(): Promise<string | null>;
  onProgress(callback: (event: EnvProgress) => void): () => void;
}

function realEnvironmentApi(bridge: NonNullable<Window["kwesi"]>["environment"]): KwesiEnvironmentApi {
  return {
    checkPrerequisites: () => bridge.checkPrerequisites(),
    checkStatus: (modelId) => bridge.checkStatus(modelId),
    install: (modelId) => bridge.install(modelId),
    installingModelId: () => bridge.installingModelId(),
    onProgress: (callback) => bridge.onProgress(callback),
  };
}

const EMPTY_STATUS = (modelId: string): EnvStatus => ({
  modelId,
  venvExists: false,
  pythonVersion: null,
  torchAvailable: false,
  cudaAvailable: null,
  installable: true,
});

/**
 * Browser-preview mock: there's no real filesystem/subprocess to check or
 * install against, so this just reports "nothing installed, no
 * prerequisites" consistently -- good enough to render the Environment
 * tab's empty/not-installed states without a real Electron main process.
 */
function createMockEnvironmentApi(): KwesiEnvironmentApi {
  const listeners = new Set<(event: EnvProgress) => void>();
  return {
    async checkPrerequisites() {
      return {
        uv: { available: false, version: null },
        git: { available: false, version: null },
        platform: "browser-preview",
      };
    },
    async checkStatus(modelId) {
      return EMPTY_STATUS(modelId);
    },
    async install(modelId) {
      return { ok: false, reason: `[mock] Can't install ${modelId}'s real environment from a browser preview.` };
    },
    async installingModelId() {
      return null;
    },
    onProgress(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export const kwesiEnvironment: KwesiEnvironmentApi = window.kwesi?.environment
  ? realEnvironmentApi(window.kwesi.environment)
  : createMockEnvironmentApi();
