import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { resolveKwesiEnv } from "./kwesiEnv.js";
import { openDatabase } from "./db/database.js";
import {
  initPaths,
  initModelsPaths,
  initVenvsPaths,
  initLogsPaths,
  initTrainedModelsPaths,
  initArtistAvatarsPaths,
} from "./db/paths.js";
import { registerDbIpcHandlers } from "./ipc/db.js";
import { registerModelsIpcHandlers } from "./ipc/models.js";
import { registerGenerationIpcHandlers } from "./ipc/generation.js";
import { registerAudioIpcHandlers } from "./ipc/audio.js";
import { registerHardwareIpcHandlers } from "./ipc/hardware.js";
import { registerTrainingIpcHandlers } from "./ipc/training.js";
import { registerSecurityIpcHandlers } from "./ipc/security.js";
import { registerProfileIpcHandlers } from "./ipc/profile.js";
import { registerArtistProfilesIpcHandlers } from "./ipc/artistProfiles.js";
import { registerCrashLogIpcHandlers } from "./ipc/crashLog.js";
import { reconcileInstalledModelsFromDisk } from "./models/reconcile.js";
import { shutdownAllRealServers } from "./models/modelServer.js";
import { reconcileTrainingRunsOnStartup } from "./models/trainingManager.js";
import { installMainProcessCrashLogging, writeCrashLog, buildCrashLogEntry } from "./logging/crashLog.js";
import { checkForUpdates } from "./updates/autoUpdate.js";

// Loads .env from the project root in dev (electron launched via `electron .`,
// so process.cwd() is the project root); silently a no-op if no .env exists
// (e.g. a packaged build, which should rely on real env vars/defaults, not a
// bundled .env file).
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

// Every directory the app depends on is resolved once at startup from
// KWESI_* env vars with sensible defaults — see kwesi.docs/02-architecture.md
// "Configuration & environment variables".
const kwesiEnv = resolveKwesiEnv(app.getPath("userData"), app.getPath("music"));

openDatabase(kwesiEnv.KWESI_DB_PATH);
initPaths(kwesiEnv.KWESI_WORKSPACES_DIR);
initModelsPaths(kwesiEnv.KWESI_MODELS_DIR);
initVenvsPaths(kwesiEnv.KWESI_VENVS_DIR);
initLogsPaths(kwesiEnv.KWESI_LOGS_DIR);
initTrainedModelsPaths(kwesiEnv.KWESI_TRAINED_MODELS_DIR);
initArtistAvatarsPaths(kwesiEnv.KWESI_ARTIST_AVATARS_DIR);

// Phase 13: local-only crash/error log (KWESI_LOGS_DIR/crashes.log) -- see
// electron/logging/crashLog.ts. Installed as early as possible so nothing
// that happens during the rest of startup goes unrecorded.
installMainProcessCrashLogging();

registerDbIpcHandlers();
registerModelsIpcHandlers();
registerGenerationIpcHandlers();
registerAudioIpcHandlers(kwesiEnv.KWESI_EXPORTS_DIR, app.getPath("downloads"));
registerHardwareIpcHandlers();
registerTrainingIpcHandlers();
registerSecurityIpcHandlers(kwesiEnv.KWESI_LOCK_IDLE_TIMEOUT_MINUTES);
registerProfileIpcHandlers();
registerArtistProfilesIpcHandlers();
registerCrashLogIpcHandlers();

// Recognizes weights already sitting in KWESI_MODELS_DIR from outside the
// app's own download queue (e.g. scripts/download_models.py) so "installed"
// status is correct before the renderer's first Model Manager fetch —
// awaited here rather than fired in the background to avoid a flash of
// stale "not installed" state on first paint.
await reconcileInstalledModelsFromDisk();

// Phase 10: any training_run left queued/preparing/running at startup has
// no live orchestration behind it anymore (see trainingManager.ts's own
// comment on why true resume isn't attempted) — surfaced as interrupted
// rather than left stuck, mirroring resetInterruptedDownloads's precedent
// in db/database.ts for the install queue.
reconcileTrainingRunsOnStartup();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#00000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Phase 13: a preload script failure previously left `window.kwesi`
  // silently `undefined` in the renderer with no trace anywhere -- the
  // exact failure mode that caught a real, pre-existing bug during this
  // phase's own verification (see kwesi.docs/02-architecture.md's
  // "Packaging & signing" notes: Electron's sandboxed preload loader
  // requires CommonJS and previously got ESM `import` syntax). Logged now
  // so a regression here is never silent again.
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeCrashLog(buildCrashLogEntry("main", "preload-error", error, { preloadPath }));
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5183");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Renderer never gets a raw shell.openExternal — only URLs that exactly
// match an entry in the static acknowledgments catalog are allowed through,
// since this channel is reachable from web content.
ipcMain.handle("kwesi:open-external", async (_event, url: string) => {
  const { ALLOWED_EXTERNAL_LINKS } = await import("./allowedExternalLinks.js");
  if (ALLOWED_EXTERNAL_LINKS.has(url)) {
    await shell.openExternal(url);
    return true;
  }
  console.warn(`Blocked attempt to open non-allowlisted external URL: ${url}`);
  return false;
});

ipcMain.handle("kwesi:get-env", () => kwesiEnv);

app.whenReady().then(() => {
  createWindow();
  // Phase 13: best-effort GitHub Releases check, packaged builds only --
  // see electron/updates/autoUpdate.ts for why this reliably no-ops against
  // this repo today (it's private) and why that's fine (fails silently to
  // the crash log, never a blocking dialog).
  checkForUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Tears down any real model-server subprocess (currently just MusicGen's)
// so it doesn't linger holding GPU memory after the app closes.
app.on("before-quit", () => {
  void shutdownAllRealServers();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Phase 13: a renderer crash (OOM, GPU-driver kill, etc.) previously left no
// trace anywhere -- recorded to the same local crashes.log as everything
// else. Electron keeps the app process alive after this; the window shows
// blank until the user relaunches, same behavior as before this phase, just
// now with a record of why.
app.on("render-process-gone", (_event, _webContents, details) => {
  writeCrashLog(
    buildCrashLogEntry("main", "render-process-gone", new Error(`Renderer process gone: ${details.reason}`), {
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
});

app.on("child-process-gone", (_event, details) => {
  writeCrashLog(
    buildCrashLogEntry(
      "main",
      "child-process-gone",
      new Error(`Child process gone: ${details.type} / ${details.reason}`),
      { type: details.type, reason: details.reason, exitCode: details.exitCode },
    ),
  );
});
