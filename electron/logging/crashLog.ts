import fs from "node:fs";
import path from "node:path";
import { logsRootDir } from "../db/paths.js";

/**
 * Local-only crash/error log -- Phase 13. No telemetry, no external
 * service: every entry is a JSON line appended to a file under
 * KWESI_LOGS_DIR, consistent with the app's stated no-account/
 * no-cloud-sync philosophy (kwesi.docs/01-overview.md). Nothing here ever
 * leaves the machine.
 */

export type CrashLogProcessName = "main" | "renderer";

export type CrashLogKind =
  | "uncaughtException"
  | "unhandledRejection"
  | "render-process-gone"
  | "child-process-gone"
  | "window-error"
  | "unhandledrejection"
  | "auto-update-error"
  | "preload-error";

export interface CrashLogEntry {
  timestamp: string;
  process: CrashLogProcessName;
  kind: CrashLogKind;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/**
 * Pure formatter -- one JSON object per line (JSONL), so the log file stays
 * append-only and trivially grep/parse-able without ever loading it whole
 * into memory. Kept separate from the actual filesystem write so it's
 * unit-testable without touching disk (see __tests__/crashLog.test.ts).
 */
export function formatCrashLogLine(entry: CrashLogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Errors thrown as non-Error values (a string, a plain object, `undefined`)
 * are common in the wild (a rejected promise can reject with anything) and
 * lose their real Error shape crossing an IPC boundary too -- normalize
 * defensively rather than assuming `.message`/`.stack` exist.
 */
export function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  if (error === undefined) return { message: "undefined" };
  if (error === null) return { message: "null" };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function buildCrashLogEntry(
  processName: CrashLogProcessName,
  kind: CrashLogKind,
  error: unknown,
  extra?: Record<string, unknown>,
): CrashLogEntry {
  const { message, stack } = normalizeError(error);
  return { timestamp: new Date().toISOString(), process: processName, kind, message, stack, extra };
}

const CRASH_LOG_FILENAME = "crashes.log";

function crashLogPath(): string {
  return path.join(logsRootDir(), CRASH_LOG_FILENAME);
}

/**
 * Append-best-effort: a failure to write the crash log must never itself
 * throw inside a process that's already mid-crash-handler, so this always
 * swallows its own errors (falling back to console.error so it's still
 * visible in a dev terminal or a `--no-sandbox` foreground launch).
 */
export function writeCrashLog(entry: CrashLogEntry): void {
  try {
    fs.mkdirSync(logsRootDir(), { recursive: true });
    fs.appendFileSync(crashLogPath(), formatCrashLogLine(entry));
  } catch (writeError) {
    console.error("[crashLog] failed to write crash log entry", writeError, entry);
  }
}

let mainProcessHooksInstalled = false;

/**
 * Hooks the main process's own crash surfaces (`uncaughtException` /
 * `unhandledRejection` on the Node `process` object -- `render-process-gone`
 * and `child-process-gone` are Electron `app` events and are wired
 * separately in main.ts, since they need the `app` import this module
 * deliberately avoids so it stays importable/testable outside Electron).
 *
 * Deliberately does NOT re-throw or call `app.exit()` after logging an
 * uncaughtException -- the safer default for a desktop app with no crash
 * server to report to is "log and keep running" where possible, which is
 * still strictly better than Electron's own default of no log at all. If
 * the process is truly unrecoverable it will still go down on its own;
 * this only ensures there's a local record of why.
 */
export function installMainProcessCrashLogging(): void {
  if (mainProcessHooksInstalled) return;
  mainProcessHooksInstalled = true;

  process.on("uncaughtException", (error) => {
    writeCrashLog(buildCrashLogEntry("main", "uncaughtException", error));
  });

  process.on("unhandledRejection", (reason) => {
    writeCrashLog(buildCrashLogEntry("main", "unhandledRejection", reason));
  });
}
