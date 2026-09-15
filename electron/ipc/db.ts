import { ipcMain } from "electron";
import * as repo from "../db/repositories.js";

export function registerDbIpcHandlers() {
  ipcMain.handle("kwesi:db:models:list", () => repo.listModels());
  ipcMain.handle("kwesi:db:modelVariants:list", (_e, modelId: string) =>
    repo.listModelVariants(modelId),
  );

  ipcMain.handle("kwesi:db:workspaces:list", () => repo.listWorkspaces());
  ipcMain.handle("kwesi:db:workspaces:create", (_e, name: string, modelId: string) =>
    repo.createWorkspace(name, modelId),
  );
  ipcMain.handle("kwesi:db:workspaces:delete", (_e, id: string, deleteFiles: boolean) =>
    repo.deleteWorkspace(id, deleteFiles),
  );

  ipcMain.handle("kwesi:db:projects:list", (_e, workspaceId: string) =>
    repo.listProjects(workspaceId),
  );
  ipcMain.handle("kwesi:db:projects:create", (_e, workspaceId: string, name: string) =>
    repo.createProject(workspaceId, name),
  );
  ipcMain.handle("kwesi:db:projects:delete", (_e, id: string, deleteFiles: boolean) =>
    repo.deleteProject(id, deleteFiles),
  );

  ipcMain.handle("kwesi:db:generations:list", (_e, projectId: string) =>
    repo.listGenerations(projectId),
  );
  ipcMain.handle(
    "kwesi:db:generations:createPlaceholder",
    (_e, projectId: string, checkpointVariant?: string) =>
      repo.createPlaceholderGeneration(projectId, checkpointVariant),
  );
  ipcMain.handle("kwesi:db:generations:delete", (_e, id: string, deleteFiles: boolean) =>
    repo.deleteGeneration(id, deleteFiles),
  );
}
