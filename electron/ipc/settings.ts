import { ipcMain, dialog, BrowserWindow } from "electron";
import * as repo from "../db/repositories.js";
import { exportsRootDir, initExportsPaths } from "../db/paths.js";
import { resetCategories } from "../reset.js";

const EXPORTS_DIR_SETTING_KEY = "exportsDir";

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

/**
 * `defaultExportsDir` is the real KWESI_EXPORTS_DIR resolved at startup
 * (electron/main.ts) -- kept here only so "use default" can get back to it
 * without re-deriving app.getPath("music") from this module.
 */
export function registerSettingsIpcHandlers(defaultExportsDir: string) {
  ipcMain.handle("kwesi:settings:reset", (_e, categories: string[]) => resetCategories(categories));
  ipcMain.handle("kwesi:settings:getExportsDir", () => exportsRootDir());
  ipcMain.handle("kwesi:settings:pickExportsDir", () => pickExportsDir());
  ipcMain.handle("kwesi:settings:resetExportsDir", () => {
    repo.deleteSetting(EXPORTS_DIR_SETTING_KEY);
    initExportsPaths(defaultExportsDir);
    return { ok: true, path: defaultExportsDir };
  });
}
