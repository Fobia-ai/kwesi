import { ipcMain, BrowserWindow } from "electron";
import * as repo from "../db/repositories.js";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  onUpdateStatus,
  setAutoUpdateEnabled,
  type UpdateStatus,
} from "../updates/autoUpdate.js";
import { resolveAutoUpdatePreference } from "../updates/updateStatus.js";

const STATUS_CHANNEL = "kwesi:updates:status";
// "true"/"false" once the Settings > About switch has been used; absent
// until then, so KWESI_AUTO_UPDATE (or the default, on) decides.
const AUTO_UPDATE_SETTING_KEY = "autoUpdate";

function broadcast(status: UpdateStatus) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(STATUS_CHANNEL, status);
  }
}

function currentPreference() {
  return resolveAutoUpdatePreference(repo.getSetting(AUTO_UPDATE_SETTING_KEY), process.env.KWESI_AUTO_UPDATE);
}

// Main -> renderer: every status change is pushed on STATUS_CHANNEL.
// Renderer -> main: getStatus (initial snapshot on mount), check, download,
// install (quit + run the installer + relaunch), and the on/off switch
// (getPreference / setEnabled), which overrides KWESI_AUTO_UPDATE. See
// electron/updates/autoUpdate.ts for the state machine itself.
export function registerUpdatesIpcHandlers() {
  initAutoUpdater(currentPreference());
  onUpdateStatus(broadcast);

  ipcMain.handle("kwesi:updates:getStatus", () => getUpdateStatus());
  ipcMain.handle("kwesi:updates:check", () => checkForUpdates());
  ipcMain.handle("kwesi:updates:download", () => downloadUpdate());
  ipcMain.handle("kwesi:updates:install", () => installUpdate());
  ipcMain.handle("kwesi:updates:getPreference", () => currentPreference());
  ipcMain.handle("kwesi:updates:setEnabled", (_event, enabled: boolean) => {
    repo.setSetting(AUTO_UPDATE_SETTING_KEY, enabled ? "true" : "false");
    const preference = currentPreference();
    return { preference, status: setAutoUpdateEnabled(preference) };
  });
}
