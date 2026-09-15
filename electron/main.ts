import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { resolveKwesiEnv } from "./kwesiEnv.js";
import { openDatabase } from "./db/database.js";
import { initPaths, initModelsPaths } from "./db/paths.js";
import { registerDbIpcHandlers } from "./ipc/db.js";
import { registerModelsIpcHandlers } from "./ipc/models.js";
import { reconcileInstalledModelsFromDisk } from "./models/reconcile.js";

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
registerDbIpcHandlers();
registerModelsIpcHandlers();

// Recognizes weights already sitting in KWESI_MODELS_DIR from outside the
// app's own download queue (e.g. scripts/download_models.py) so "installed"
// status is correct before the renderer's first Model Manager fetch —
// awaited here rather than fired in the background to avoid a flash of
// stale "not installed" state on first paint.
await reconcileInstalledModelsFromDisk();

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
