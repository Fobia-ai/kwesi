import { ipcMain, dialog, BrowserWindow } from "electron";
import * as repo from "../db/repositories.js";
import { exportsRootDir, initExportsPaths, modelsRootDir, initModelsPaths } from "../db/paths.js";
import { resetCategories } from "../reset.js";
import { detectModelDrift, reconcileInstalledModelsFromDisk, type ModelDrift } from "../models/reconcile.js";

const EXPORTS_DIR_SETTING_KEY = "exportsDir";
const MODELS_DIR_SETTING_KEY = "modelsDir";

// Same native folder-picker pattern electron/ipc/training.ts's
// pickOutputDir/pickDatasetDir already use.
async function pickExportsDir(): Promise<{ ok: boolean; path?: string }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const opts = {
    title: "Choose an export location",
    defaultPath: exportsRootDir(),
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  const path = result.filePaths[0];
  repo.setSetting(EXPORTS_DIR_SETTING_KEY, path);
  initExportsPaths(path);
  return { ok: true, path };
}

function hasAnyModelsInstalled(): boolean {
  return repo.listAllModelVariants().some((v) => v.install_status === "installed");
}

// Only picks a folder -- doesn't switch anything yet. Split from
// applyModelsDir so the renderer can show its "models exist, proceed
// anyway?" warning *before* the native dialog opens, and so cancelling the
// dialog never touches state.
async function pickModelsDir(): Promise<{ ok: boolean; path?: string }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const opts = {
    title: "Choose a models folder",
    defaultPath: modelsRootDir(),
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
}

/**
 * Actually switches KWESI_MODELS_DIR to a folder already picked via
 * pickModelsDir -- persists the override (so it survives relaunch, same as
 * exportsDir), repoints every modelsRootDir()/modelVariantDir() call at the
 * new location, then reconciles model_variant against whatever's really
 * there. That's normally nothing, unless the user already moved their old
 * checkpoints into the new folder themselves (which Settings' UI advises
 * doing first, to avoid a redundant re-download) -- the returned drift lets
 * the renderer report what it actually found.
 */
async function applyModelsDir(newPath: string): Promise<{ ok: boolean; path: string; drift: ModelDrift }> {
  repo.setSetting(MODELS_DIR_SETTING_KEY, newPath);
  initModelsPaths(newPath);
  const drift = await reconcileInstalledModelsFromDisk();
  return { ok: true, path: newPath, drift };
}

/**
 * `defaultExportsDir`/`defaultModelsDir` are the real KWESI_EXPORTS_DIR/
 * KWESI_MODELS_DIR resolved at startup (electron/main.ts) -- kept here only
 * so "use default" can get back to them without re-deriving
 * app.getPath(...) from this module.
 */
export function registerSettingsIpcHandlers(defaultExportsDir: string, defaultModelsDir: string) {
  ipcMain.handle("kwesi:settings:reset", (_e, categories: string[]) => resetCategories(categories));
  ipcMain.handle("kwesi:settings:getExportsDir", () => exportsRootDir());
  ipcMain.handle("kwesi:settings:pickExportsDir", () => pickExportsDir());
  ipcMain.handle("kwesi:settings:resetExportsDir", () => {
    repo.deleteSetting(EXPORTS_DIR_SETTING_KEY);
    initExportsPaths(defaultExportsDir);
    return { ok: true, path: defaultExportsDir };
  });

  ipcMain.handle("kwesi:settings:getModelsDir", () => modelsRootDir());
  ipcMain.handle("kwesi:settings:hasModelsInstalled", () => hasAnyModelsInstalled());
  ipcMain.handle("kwesi:settings:pickModelsDir", () => pickModelsDir());
  ipcMain.handle("kwesi:settings:applyModelsDir", (_e, newPath: string) => applyModelsDir(newPath));
  ipcMain.handle("kwesi:settings:resetModelsDir", async () => {
    repo.deleteSetting(MODELS_DIR_SETTING_KEY);
    initModelsPaths(defaultModelsDir);
    const drift = await reconcileInstalledModelsFromDisk();
    return { ok: true, path: defaultModelsDir, drift };
  });
  // Home's resolver banner: detect (read-only, on mount) vs. resolve (the
  // user's explicit "Resolve" click) -- kept as two channels rather than one
  // with a "dryRun" flag so the renderer's intent is unambiguous from the
  // call site alone.
  ipcMain.handle("kwesi:settings:checkModelsDrift", () => detectModelDrift());
  ipcMain.handle("kwesi:settings:resolveModelsDrift", () => reconcileInstalledModelsFromDisk());
}
