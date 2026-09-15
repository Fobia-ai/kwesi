import { ipcMain } from "electron";
import { writeCrashLog, type CrashLogEntry } from "../logging/crashLog.js";

export interface RendererCrashReportPayload {
  kind: "window-error" | "unhandledrejection";
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

// Renderer-side crashes (window.onerror / unhandledrejection, hooked in
// src/lib/crashLog.ts) are forwarded here so they land in the same local
// crashes.log as main-process crashes, rather than only ever reaching
// DevTools console where nobody sees them after the fact.
export function registerCrashLogIpcHandlers() {
  ipcMain.handle("kwesi:crashLog:report", (_event, payload: RendererCrashReportPayload) => {
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      process: "renderer",
      kind: payload.kind,
      message: payload.message,
      stack: payload.stack,
      extra: payload.extra,
    };
    writeCrashLog(entry);
  });
}
