import { ipcMain, BrowserWindow } from "electron";
import {
  checkUvAvailable,
  checkGitAvailable,
  checkEnvironmentStatus,
  installEnvironment,
  type EnvProgress,
} from "../models/envInstaller.js";

const PROGRESS_CHANNEL = "kwesi:environment:progress";

function broadcast(event: EnvProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

// One install at a time, globally -- these are real, heavy subprocesses
// (uv/git/pip) sharing this machine's network and disk; running several
// concurrently would just make every progress log an interleaved mess for
// no real speed benefit, the same "one active job" posture
// models/downloadQueue.ts already takes for weight downloads.
let installingModelId: string | null = null;

export function registerEnvironmentIpcHandlers() {
  ipcMain.handle("kwesi:environment:checkPrerequisites", async () => ({
    uv: await checkUvAvailable(),
    git: await checkGitAvailable(),
    // One cheap fact bundled in here rather than its own channel -- the
    // Environment tab's only use for it is per-model OS-compatibility
    // badges (see ModelHardware.platforms), not a general-purpose platform API.
    platform: process.platform,
  }));

  ipcMain.handle("kwesi:environment:checkStatus", (_e, modelId: string) => checkEnvironmentStatus(modelId));

  ipcMain.handle("kwesi:environment:install", async (_e, modelId: string) => {
    if (installingModelId) {
      return { ok: false, reason: `Already installing ${installingModelId} -- wait for it to finish first.` };
    }
    installingModelId = modelId;
    broadcast({ modelId, line: "Starting install…" });
    try {
      const result = await installEnvironment(modelId, (line) => broadcast({ modelId, line }));
      broadcast({ modelId, line: result.ok ? "Done." : `Failed: ${result.reason}` });
      return result;
    } finally {
      installingModelId = null;
    }
  });

  ipcMain.handle("kwesi:environment:installingModelId", () => installingModelId);
}
