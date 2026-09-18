import { listAll as listAllMockModelVariants } from "./modelVariantStore";
import type { ModelDrift } from "./kwesiBridge";

export type { ModelDrift } from "./kwesiBridge";

export type ResetCategory = "models" | "music" | "trainedModels" | "artistProfiles" | "exports";

export interface KwesiSettingsApi {
  reset(categories: ResetCategory[]): Promise<{ ok: boolean; reason?: string }>;
  getExportsDir(): Promise<string>;
  pickExportsDir(): Promise<{ ok: boolean; path?: string }>;
  resetExportsDir(): Promise<{ ok: boolean; path?: string }>;
  // Only the models folder is user-changeable/reconcilable -- workspaces,
  // exports (above), trained models, etc. stay fixed at their resolved
  // KWESI_* env paths, per how this was scoped.
  getModelsDir(): Promise<string>;
  hasModelsInstalled(): Promise<boolean>;
  pickModelsDir(): Promise<{ ok: boolean; path?: string }>;
  applyModelsDir(path: string): Promise<{ ok: boolean; path: string; drift: ModelDrift }>;
  resetModelsDir(): Promise<{ ok: boolean; path: string; drift: ModelDrift }>;
  checkModelsDrift(): Promise<ModelDrift>;
  resolveModelsDrift(): Promise<ModelDrift>;
  // The Acknowledgments screen ("/") is meant to show once, ever -- not on
  // every launch. Presence-only flag, same convention as the security
  // passcode setting.
  getAcknowledged(): Promise<boolean>;
  setAcknowledged(): Promise<{ ok: boolean }>;
}

function realSettingsApi(bridge: NonNullable<Window["kwesi"]>["settings"]): KwesiSettingsApi {
  return {
    reset: (categories) => bridge.reset(categories),
    getExportsDir: () => bridge.getExportsDir(),
    pickExportsDir: () => bridge.pickExportsDir(),
    resetExportsDir: () => bridge.resetExportsDir(),
    getModelsDir: () => bridge.getModelsDir(),
    hasModelsInstalled: () => bridge.hasModelsInstalled(),
    pickModelsDir: () => bridge.pickModelsDir(),
    applyModelsDir: (path) => bridge.applyModelsDir(path),
    resetModelsDir: () => bridge.resetModelsDir(),
    checkModelsDrift: () => bridge.checkModelsDrift(),
    resolveModelsDrift: () => bridge.resolveModelsDrift(),
    getAcknowledged: () => bridge.getAcknowledged(),
    setAcknowledged: () => bridge.setAcknowledged(),
  };
}

// Mirrors each mock store's own localStorage key (src/lib/modelVariantStore.ts,
// db.ts, training.ts, artistProfiles.ts) -- browser-preview dev only, no real
// files to wipe.
const MOCK_STORAGE_KEYS: Record<ResetCategory, string | null> = {
  models: "kwesi-mock-model-variants-v1",
  music: "kwesi-mock-db-v1",
  trainedModels: "kwesi-mock-training-v1",
  artistProfiles: "kwesi-mock-artist-profiles",
  exports: null,
};

const MOCK_EXPORTS_DIR_KEY = "kwesi-mock-exports-dir";
const MOCK_DEFAULT_EXPORTS_DIR = "/mock/exports";
const MOCK_MODELS_DIR_KEY = "kwesi-mock-models-dir";
const MOCK_DEFAULT_MODELS_DIR = "/mock/models";
const MOCK_ACKNOWLEDGED_KEY = "kwesi-mock-acknowledged-v1";
const EMPTY_DRIFT: ModelDrift = { toInstalled: [], toNotInstalled: [] };

function createMockSettingsApi(): KwesiSettingsApi {
  return {
    async reset(categories) {
      try {
        for (const category of categories) {
          const key = MOCK_STORAGE_KEYS[category];
          if (key) localStorage.removeItem(key);
        }
      } catch {
        // best-effort only; mock persistence is a dev convenience, not a guarantee
      }
      return { ok: true };
    },
    async getExportsDir() {
      try {
        return localStorage.getItem(MOCK_EXPORTS_DIR_KEY) ?? MOCK_DEFAULT_EXPORTS_DIR;
      } catch {
        return MOCK_DEFAULT_EXPORTS_DIR;
      }
    },
    async pickExportsDir() {
      // No real native folder picker in a plain browser preview -- picks a
      // fixed fake path, same convention src/lib/training.ts's mock
      // pickOutputDir/pickDatasetDir already use.
      const path = "/mock/exports/chosen-folder";
      try {
        localStorage.setItem(MOCK_EXPORTS_DIR_KEY, path);
      } catch {
        // best-effort only
      }
      return { ok: true, path };
    },
    async resetExportsDir() {
      try {
        localStorage.removeItem(MOCK_EXPORTS_DIR_KEY);
      } catch {
        // best-effort only
      }
      return { ok: true, path: MOCK_DEFAULT_EXPORTS_DIR };
    },
    async getModelsDir() {
      try {
        return localStorage.getItem(MOCK_MODELS_DIR_KEY) ?? MOCK_DEFAULT_MODELS_DIR;
      } catch {
        return MOCK_DEFAULT_MODELS_DIR;
      }
    },
    async hasModelsInstalled() {
      return listAllMockModelVariants().some((v) => v.install_status === "installed");
    },
    async pickModelsDir() {
      const path = "/mock/models/chosen-folder";
      try {
        localStorage.setItem(MOCK_MODELS_DIR_KEY, path);
      } catch {
        // best-effort only
      }
      return { ok: true, path };
    },
    async applyModelsDir(path) {
      try {
        localStorage.setItem(MOCK_MODELS_DIR_KEY, path);
      } catch {
        // best-effort only
      }
      // No real disk to reconcile against in the browser preview.
      return { ok: true, path, drift: EMPTY_DRIFT };
    },
    async resetModelsDir() {
      try {
        localStorage.removeItem(MOCK_MODELS_DIR_KEY);
      } catch {
        // best-effort only
      }
      return { ok: true, path: MOCK_DEFAULT_MODELS_DIR, drift: EMPTY_DRIFT };
    },
    async checkModelsDrift() {
      return EMPTY_DRIFT;
    },
    async resolveModelsDrift() {
      return EMPTY_DRIFT;
    },
    async getAcknowledged() {
      try {
        return localStorage.getItem(MOCK_ACKNOWLEDGED_KEY) !== null;
      } catch {
        return false;
      }
    },
    async setAcknowledged() {
      try {
        localStorage.setItem(MOCK_ACKNOWLEDGED_KEY, "1");
      } catch {
        // best-effort only
      }
      return { ok: true };
    },
  };
}

export const kwesiSettings: KwesiSettingsApi = window.kwesi?.settings
  ? realSettingsApi(window.kwesi.settings)
  : createMockSettingsApi();
