import { ipcMain } from "electron";
import * as repo from "../db/repositories.js";

export function registerProfileIpcHandlers() {
  ipcMain.handle("kwesi:profile:get", () => repo.getProfile());
  ipcMain.handle("kwesi:profile:save", (_e, displayName: string | null, email: string | null) =>
    repo.saveProfile(displayName, email),
  );
}
