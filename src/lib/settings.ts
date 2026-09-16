export type ResetCategory = "models" | "music" | "trainedModels" | "artistProfiles" | "exports";

export interface KwesiSettingsApi {
  reset(categories: ResetCategory[]): Promise<{ ok: boolean; reason?: string }>;
  getExportsDir(): Promise<string>;
  pickExportsDir(): Promise<{ ok: boolean; path?: string }>;
  resetExportsDir(): Promise<{ ok: boolean; path?: string }>;
}

function realSettingsApi(bridge: NonNullable<Window["kwesi"]>["settings"]): KwesiSettingsApi {
  return {
    reset: (categories) => bridge.reset(categories),
    getExportsDir: () => bridge.getExportsDir(),
    pickExportsDir: () => bridge.pickExportsDir(),
    resetExportsDir: () => bridge.resetExportsDir(),
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
  };
}

export const kwesiSettings: KwesiSettingsApi = window.kwesi?.settings
  ? realSettingsApi(window.kwesi.settings)
  : createMockSettingsApi();
