import { ipcMain } from "electron";
import * as appLock from "../security/appLock.js";

export function registerSecurityIpcHandlers(defaultIdleTimeoutMinutes: number) {
  ipcMain.handle("kwesi:security:hasPasscode", () => appLock.hasPasscode());
  ipcMain.handle("kwesi:security:setPasscode", (_e, passcode: string) => appLock.setPasscode(passcode));
  ipcMain.handle("kwesi:security:removePasscode", () => appLock.removePasscode());
  ipcMain.handle("kwesi:security:verifyPasscode", (_e, attempt: string) => appLock.verifyPasscode(attempt));
  ipcMain.handle("kwesi:security:getIdleTimeoutMinutes", () =>
    appLock.getIdleTimeoutMinutes(defaultIdleTimeoutMinutes),
  );
  ipcMain.handle("kwesi:security:setIdleTimeoutMinutes", (_e, minutes: number) =>
    appLock.setIdleTimeoutMinutes(minutes),
  );
}
