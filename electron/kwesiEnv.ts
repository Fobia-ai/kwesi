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
  KWESI_SERVERS_DIR: string;
  KWESI_WORKSPACES_DIR: string;
  KWESI_EXPORTS_DIR: string;
  KWESI_CACHE_DIR: string;
  KWESI_LOGS_DIR: string;
  KWESI_TRAINED_MODELS_DIR: string;
  KWESI_ARTIST_AVATARS_DIR: string;
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
    // Where a model's vendored source (git-cloned on demand from Settings > Environment,
    // e.g. ace-step-1.5's vendor/) lives. This used to be computed as "two directories up
    // from whichever compiled .js file happened to be asking" (path.dirname(fileURLToPath(
    // import.meta.url)) + "/../.."), which only ever pointed at a real, writable location by
    // coincidence: in dev, dist-electron/models/*.js really does sit two levels under the repo
    // root, so "servers/" was a real sibling directory. In a packaged build, that same file is
    // loaded from inside app.asar - Electron's single-file archive - so "two levels up" landed
    // *inside* app.asar too, and `git clone` (a real external process with no idea app.asar
    // isn't a folder) failed with "fatal: could not create leading directories... Not a
    // directory". Every other on-disk root (venvs, models, logs, ...) already gets a real,
    // env-var-backed location the same way KWESI_HOME's siblings do; this one just never had
    // one. Not OS-specific - reproduces identically on macOS and Linux, a Windows install just
    // happened to hit it first.
    KWESI_SERVERS_DIR: process.env.KWESI_SERVERS_DIR || path.join(home, "servers"),
    KWESI_WORKSPACES_DIR: process.env.KWESI_WORKSPACES_DIR || path.join(home, "workspaces"),
    KWESI_EXPORTS_DIR: process.env.KWESI_EXPORTS_DIR || path.join(musicDir, "Kwesi"),
    KWESI_CACHE_DIR: process.env.KWESI_CACHE_DIR || path.join(home, "cache"),
    KWESI_LOGS_DIR: process.env.KWESI_LOGS_DIR || path.join(home, "logs"),
    KWESI_TRAINED_MODELS_DIR:
      process.env.KWESI_TRAINED_MODELS_DIR || path.join(modelsDir, "custom"),
    KWESI_ARTIST_AVATARS_DIR:
      process.env.KWESI_ARTIST_AVATARS_DIR || path.join(home, "artist-avatars"),
    KWESI_MODEL_SERVER_PORT_RANGE: process.env.KWESI_MODEL_SERVER_PORT_RANGE || "17600-17999",
    KWESI_LOCK_IDLE_TIMEOUT_MINUTES: Number(process.env.KWESI_LOCK_IDLE_TIMEOUT_MINUTES ?? 10),
  };
}
