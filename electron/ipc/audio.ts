import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { workspacesRootDir } from "../db/paths.js";

// Every path this channel touches is checked against the workspaces root
// before any filesystem call — output_files on a generation row are always
// server-written paths under KWESI_WORKSPACES_DIR, so a renderer asking for
// anything outside that tree is treated as untrusted rather than honored,
// per the same allowlisting posture as electron/allowedExternalLinks.ts.
function isWithinWorkspaces(filePath: string): boolean {
  const root = path.resolve(workspacesRootDir());
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".aiff":
      return "audio/aiff";
    default:
      return "application/octet-stream";
  }
}

export interface AudioStatResult {
  exists: boolean;
  sizeBytes: number;
}

async function statAudioFile(filePath: string): Promise<AudioStatResult> {
  if (!isWithinWorkspaces(filePath)) return { exists: false, sizeBytes: 0 };
  try {
    const stat = await fs.promises.stat(filePath);
    return { exists: stat.isFile(), sizeBytes: stat.size };
  } catch {
    return { exists: false, sizeBytes: 0 };
  }
}

export interface AudioReadResult {
  ok: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
  reason?: string;
}

async function readAudioFile(filePath: string): Promise<AudioReadResult> {
  if (!isWithinWorkspaces(filePath)) return { ok: false, reason: "Path outside workspaces directory" };
  try {
    const buf = await fs.promises.readFile(filePath);
    if (buf.byteLength === 0) return { ok: false, reason: "File is empty" };
    return { ok: true, bytes: new Uint8Array(buf), mimeType: mimeTypeFor(filePath) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface AudioSaveResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

/**
 * "Export" and "Download" are the same real mechanism — copy the generated
 * file to a user-chosen destination via the native save dialog — differing
 * only in the folder the dialog opens to (KWESI_EXPORTS_DIR vs. the OS
 * Downloads folder). A local desktop app has no meaningful distinction
 * between "export a copy" and "download a copy" once there's no server in
 * the loop, so this deliberately isn't two code paths.
 */
async function saveAudioCopy(
  filePath: string,
  suggestedName: string,
  kind: "export" | "download",
  exportsDir: string,
  downloadsDir: string,
): Promise<AudioSaveResult> {
  if (!isWithinWorkspaces(filePath)) return { ok: false, reason: "Path outside workspaces directory" };
  if (!fs.existsSync(filePath)) return { ok: false, reason: "Source file not found" };

  const defaultDir = kind === "download" ? downloadsDir : exportsDir;
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
  const result = win
    ? await dialog.showSaveDialog(win, {
        title: kind === "download" ? "Download audio" : "Export audio",
        defaultPath: path.join(defaultDir, suggestedName),
      })
    : await dialog.showSaveDialog({
        title: kind === "download" ? "Download audio" : "Export audio",
        defaultPath: path.join(defaultDir, suggestedName),
      });
  if (result.canceled || !result.filePath) return { ok: false, reason: "cancelled" };

  await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
  await fs.promises.copyFile(filePath, result.filePath);
  return { ok: true, path: result.filePath };
}

function revealInFolder(filePath: string): { ok: boolean } {
  if (!isWithinWorkspaces(filePath)) return { ok: false };
  if (!fs.existsSync(filePath)) return { ok: false };
  shell.showItemInFolder(filePath);
  return { ok: true };
}

export function registerAudioIpcHandlers(exportsDir: string, downloadsDir: string) {
  ipcMain.handle("kwesi:audio:stat", (_e, filePath: string) => statAudioFile(filePath));
  ipcMain.handle("kwesi:audio:read", (_e, filePath: string) => readAudioFile(filePath));
  ipcMain.handle(
    "kwesi:audio:save",
    (_e, filePath: string, suggestedName: string, kind: "export" | "download") =>
      saveAudioCopy(filePath, suggestedName, kind, exportsDir, downloadsDir),
  );
  ipcMain.handle("kwesi:audio:reveal", (_e, filePath: string) => revealInFolder(filePath));
}
