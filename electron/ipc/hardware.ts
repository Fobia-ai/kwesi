import { ipcMain } from "electron";
import { queryGpuVram, type GpuVramInfo } from "../models/gpuInfo.js";

// Phase 8: hardware-gating UI needs real, live VRAM numbers from the main
// process rather than a static manifest assumption — a machine's free VRAM
// changes generation to generation (other apps, other models still warm in
// this app's own real servers). Queried fresh on every call rather than
// cached, since it's cheap (~single nvidia-smi invocation, a few ms) and a
// stale cached value defeats the point of a pre-flight check.
export function registerHardwareIpcHandlers() {
  ipcMain.handle("kwesi:hardware:gpuVram", (): Promise<GpuVramInfo> => queryGpuVram());
}
