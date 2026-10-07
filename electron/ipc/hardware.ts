import { ipcMain } from "electron";
import { queryGpuVram, querySystemResources, type GpuVramInfo, type SystemResources } from "../models/gpuInfo.js";
import { loadedServerModelIds } from "../models/modelServer.js";

// Phase 8: hardware-gating UI needs real, live VRAM numbers from the main
// process rather than a static manifest assumption — a machine's free VRAM
// changes generation to generation (other apps, other models still warm in
// this app's own real servers). Queried fresh on every call rather than
// cached, since it's cheap (~single nvidia-smi invocation, a few ms) and a
// stale cached value defeats the point of a pre-flight check.
export function registerHardwareIpcHandlers() {
  ipcMain.handle("kwesi:hardware:gpuVram", (): Promise<GpuVramInfo> => queryGpuVram());
  // The resource card's live snapshot: GPU and system memory, plus which
  // models Kwesi itself has loaded (so a full GPU can be explained).
  ipcMain.handle(
    "kwesi:hardware:resources",
    async (): Promise<SystemResources & { loadedModelIds: string[] }> => ({
      ...(await querySystemResources()),
      loadedModelIds: loadedServerModelIds(),
    }),
  );
}
