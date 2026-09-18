// Main-process side of a request/response shape that doesn't exist
// elsewhere in this app: every other IPC channel is either renderer-invokes-
// main (ipcMain.handle/invoke) or main-broadcasts-to-all-renderers
// (webContents.send, fire-and-forget -- see modelServer.ts's broadcast()).
// Real MIDI->audio rendering needs the opposite: the main process (a
// generation job) has to ASK the renderer to do real Web Audio work (Tone.js
// + OfflineAudioContext -- Node has no Web Audio API at all) and wait for
// the answer. See src/lib/audioRenderListener.ts for the renderer side, and
// electron/models/modelServer.ts's runRealMidiJob for the caller.
import { ipcMain, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const REQUEST_CHANNEL = "kwesi:audioRender:request";
const RESPONSE_CHANNEL = "kwesi:audioRender:response";

interface RenderResponse {
  requestId: string;
  ok: boolean;
  wavBytes?: Uint8Array;
  reason?: string;
}

const pending = new Map<string, (response: RenderResponse) => void>();

export function registerAudioRenderIpcHandlers() {
  // Single persistent listener (not a fresh ipcMain.once per request) --
  // cleaner lifecycle, no per-request listener to leak if a request times
  // out before the renderer ever responds.
  ipcMain.on(RESPONSE_CHANNEL, (_event, response: RenderResponse) => {
    const resolve = pending.get(response.requestId);
    if (!resolve) return; // late response after our own timeout already fired -- ignore
    pending.delete(response.requestId);
    resolve(response);
  });
}

/**
 * Asks the renderer to render a real MIDI file to WAV bytes and writes the
 * result to `outputPath` -- main owns the file write (not the renderer),
 * matching how every other job in modelServer.ts writes its own output
 * directly, and avoiding a second new "silent write anywhere" IPC handler.
 *
 * Never rejects: every failure path (no window, timeout, renderer-side
 * error, write failure) resolves to `{ok: false, reason}`, so a render
 * problem can never turn a successful MIDI generation into a failed one --
 * see runRealMidiJob's call site, which treats this as a soft, optional step.
 */
export async function requestRendererAudioRender(
  midiPath: string,
  outputPath: string,
  timeoutMs = 180_000,
): Promise<{ ok: boolean; outputPath?: string; reason?: string }> {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return { ok: false, reason: "No renderer window available" };

  const requestId = randomUUID();
  const response = await new Promise<RenderResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ requestId, ok: false, reason: `Renderer did not respond within ${timeoutMs}ms` });
    }, timeoutMs);
    pending.set(requestId, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    win.webContents.send(REQUEST_CHANNEL, { requestId, midiPath });
  });

  if (!response.ok || !response.wavBytes) {
    return { ok: false, reason: response.reason ?? "render failed" };
  }
  try {
    await fs.promises.writeFile(outputPath, Buffer.from(response.wavBytes));
    return { ok: true, outputPath };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
