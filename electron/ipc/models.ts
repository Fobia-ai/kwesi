import { ipcMain } from "electron";
import * as repo from "../db/repositories.js";
import {
  enqueueInstall,
  retryInstall,
  cancelJob,
  removeVariant,
} from "../models/downloadQueue.js";
import { getFreeBytes } from "../models/diskSpace.js";
import { modelsRootDir } from "../db/paths.js";

export function registerModelsIpcHandlers() {
  ipcMain.handle("kwesi:models:install", (_e, modelId: string, variantName: string) =>
    enqueueInstall(modelId, variantName),
  );
  ipcMain.handle("kwesi:models:retry", (_e, modelId: string, variantName: string) =>
    retryInstall(modelId, variantName),
  );
  ipcMain.handle("kwesi:models:cancel", (_e, variantId: string) => cancelJob(variantId));
  ipcMain.handle("kwesi:models:remove", (_e, modelId: string, variantName: string) =>
    removeVariant(modelId, variantName),
  );
  ipcMain.handle("kwesi:models:queue:list", () => repo.listInstallQueue());
  ipcMain.handle("kwesi:models:workspacesUsingModel", (_e, modelId: string) =>
    repo.listWorkspacesUsingModel(modelId),
  );
  ipcMain.handle("kwesi:models:diskFreeBytes", () => getFreeBytes(modelsRootDir()));
}
