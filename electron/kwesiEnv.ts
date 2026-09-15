import path from "node:path";

/**
 * Resolves every KWESI_* directory/config value the app depends on.
 * Precedence: explicit env var > (later) persisted setting > built-in default.
 * See kwesi.docs/02-architecture.md "Configuration & environment variables".
 */
export interface KwesiEnv {
  KWESI_HOME: string;
  KWESI_DB_PATH: string;
  KWESI_MODELS_DIR: string;
  KWESI_VENVS_DIR: string;
  KWESI_WORKSPACES_DIR: string;
  KWESI_EXPORTS_DIR: string;
  KWESI_CACHE_DIR: string;
  KWESI_LOGS_DIR: string;
  KWESI_TRAINED_MODELS_DIR: string;
  KWESI_MODEL_SERVER_PORT_RANGE: string;
  KWESI_LOCK_IDLE_TIMEOUT_MINUTES: number;
}

export function resolveKwesiEnv(userDataDir: string, musicDir: string): KwesiEnv {
  const home = process.env.KWESI_HOME || userDataDir;
  const modelsDir = process.env.KWESI_MODELS_DIR || path.join(home, "models");

  return {
    KWESI_HOME: home,
    KWESI_DB_PATH: process.env.KWESI_DB_PATH || path.join(home, "kwesi.db"),
    KWESI_MODELS_DIR: modelsDir,
    KWESI_VENVS_DIR: process.env.KWESI_VENVS_DIR || path.join(home, "venvs"),
    KWESI_WORKSPACES_DIR: process.env.KWESI_WORKSPACES_DIR || path.join(home, "workspaces"),
    KWESI_EXPORTS_DIR: process.env.KWESI_EXPORTS_DIR || path.join(musicDir, "Kwesi"),
    KWESI_CACHE_DIR: process.env.KWESI_CACHE_DIR || path.join(home, "cache"),
    KWESI_LOGS_DIR: process.env.KWESI_LOGS_DIR || path.join(home, "logs"),
    KWESI_TRAINED_MODELS_DIR:
      process.env.KWESI_TRAINED_MODELS_DIR || path.join(modelsDir, "custom"),
    KWESI_MODEL_SERVER_PORT_RANGE: process.env.KWESI_MODEL_SERVER_PORT_RANGE || "17600-17999",
    KWESI_LOCK_IDLE_TIMEOUT_MINUTES: Number(process.env.KWESI_LOCK_IDLE_TIMEOUT_MINUTES ?? 10),
  };
}
