import { ipcMain, dialog, BrowserWindow } from "electron";
import * as repo from "../db/repositories.js";
import { submitTrainingRun, cancelTrainingRun, type SubmitTrainingRunParams } from "../models/trainingManager.js";
import { kwesiTrainedModelsDir } from "../db/paths.js";

/**
 * Real native folder-picker for the training output-directory field, same
 * `dialog.show*` pattern electron/ipc/audio.ts already uses for the
 * save-file dialog (Export/Download). `defaultPath` seeds the picker at
 * KWESI_TRAINED_MODELS_DIR/<modelId>/<runName> — always user-editable from
 * there, matching how KWESI_EXPORTS_DIR only seeds Export's dialog rather
 * than locking the destination.
 */
async function pickOutputDir(modelId: string, runName: string): Promise<{ ok: boolean; path?: string }> {
  const defaultPath = kwesiTrainedModelsDir(modelId, runName);
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, { title: "Choose a save location", defaultPath, properties: ["openDirectory", "createDirectory"] })
    : await dialog.showOpenDialog({ title: "Choose a save location", defaultPath, properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
}

/**
 * Phase 11: MuseCoco's real dataset input is a pre-binarized fairseq
 * data-bin *directory* (dict.txt + .bin/.idx files — see
 * trainingManager.ts's runMuseCocoTrainingPipeline's honest scope-cut
 * comment), not individual audio/MIDI files the way every other trainable
 * model's dataset is — so it needs a directory picker instead of
 * Training.tsx's usual multi-file drop-zone.
 */
async function pickDatasetDir(): Promise<{ ok: boolean; path?: string }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const opts = { title: "Choose a dataset directory", properties: ["openDirectory"] as Array<"openDirectory"> };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
}

export function registerTrainingIpcHandlers() {
  ipcMain.handle("kwesi:training:submit", (_e, params: SubmitTrainingRunParams) => submitTrainingRun(params));
  ipcMain.handle("kwesi:training:pickDatasetDir", () => pickDatasetDir());
  ipcMain.handle("kwesi:training:list", (_e, modelId?: string) => repo.listTrainingRuns(modelId));
  ipcMain.handle("kwesi:training:get", (_e, runId: string) => repo.getTrainingRunById(runId) ?? null);
  ipcMain.handle("kwesi:training:cancel", (_e, runId: string) => cancelTrainingRun(runId));
  ipcMain.handle("kwesi:training:listTrainedModels", (_e, modelId?: string) => repo.listTrainedModels(modelId));
  ipcMain.handle("kwesi:training:pickOutputDir", (_e, modelId: string, runName: string) => pickOutputDir(modelId, runName));
  ipcMain.handle("kwesi:training:defaultOutputDir", (_e, modelId: string, runName: string) =>
    kwesiTrainedModelsDir(modelId, runName),
  );
}
