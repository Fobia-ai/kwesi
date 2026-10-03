import type { EnvStatus, EnvProgress, MusecocoGpuStatus } from "./kwesiBridge";

export type { EnvStatus, EnvProgress, MusecocoGpuStatus } from "./kwesiBridge";

export interface KwesiEnvironmentApi {
  checkPrerequisites(): Promise<{
    uv: { available: boolean; version: string | null };
    git: { available: boolean; version: string | null };
    platform: string;
  }>;
  checkStatus(modelId: string): Promise<EnvStatus>;
  install(modelId: string): Promise<{ ok: boolean; reason?: string }>;
  installingModelId(): Promise<string | null>;
  // Training uses a venv that may differ from inference (RAVE trains in a
  // separate `rave-train`), so these check/install that one specifically.
  checkTrainingStatus(modelId: string): Promise<EnvStatus>;
  installTraining(modelId: string): Promise<{ ok: boolean; reason?: string }>;
  // MuseCoco's optional GPU kernel build, offered from the Training screen.
  musecocoGpuStatus(): Promise<MusecocoGpuStatus>;
  buildMusecocoGpu(): Promise<{ ok: boolean; reason?: string }>;
  onProgress(callback: (event: EnvProgress) => void): () => void;
}

function realEnvironmentApi(bridge: NonNullable<Window["kwesi"]>["environment"]): KwesiEnvironmentApi {
  return {
    checkPrerequisites: () => bridge.checkPrerequisites(),
    checkStatus: (modelId) => bridge.checkStatus(modelId),
    install: (modelId) => bridge.install(modelId),
    installingModelId: () => bridge.installingModelId(),
    checkTrainingStatus: (modelId) => bridge.checkTrainingStatus(modelId),
    installTraining: (modelId) => bridge.installTraining(modelId),
    musecocoGpuStatus: () => bridge.musecocoGpuStatus(),
    buildMusecocoGpu: () => bridge.buildMusecocoGpu(),
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
    async checkTrainingStatus(modelId) {
      return EMPTY_STATUS(modelId);
    },
    async installTraining(modelId) {
      return { ok: false, reason: `[mock] Can't install ${modelId}'s training environment from a browser preview.` };
    },
    async musecocoGpuStatus() {
      return { supported: false, built: false, reason: "[mock] GPU builds need the desktop app." };
    },
    async buildMusecocoGpu() {
      return { ok: false, reason: "[mock] GPU builds need the desktop app." };
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
