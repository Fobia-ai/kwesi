import { ipcMain } from "electron";
import { submitGeneration, startServer, stopServer, getServerStatus } from "../models/modelServer.js";

export function registerGenerationIpcHandlers() {
  ipcMain.handle(
    "kwesi:generation:submit",
    (_e, projectId: string, checkpointVariant: string | null, inputParams: Record<string, unknown>, outputKind: string) =>
      submitGeneration(projectId, checkpointVariant, inputParams, outputKind),
  );
  ipcMain.handle("kwesi:generation:server:start", (_e, modelId: string) => startServer(modelId));
  ipcMain.handle("kwesi:generation:server:stop", (_e, modelId: string) => stopServer(modelId));
  ipcMain.handle("kwesi:generation:server:status", (_e, modelId: string) => getServerStatus(modelId));
}
