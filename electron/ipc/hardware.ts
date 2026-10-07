import { ipcMain } from "electron";
import { queryGpuVram, querySystemResources, type GpuVramInfo, type SystemResources } from "../models/gpuInfo.js";
import { loadedServerDevices, loadedServerModelIds, stopIdleServers } from "../models/modelServer.js";
import { getDevicePreference, setDevicePreference, type DevicePreference } from "../models/devicePreference.js";

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
    async (): Promise<
      SystemResources & {
        loadedModelIds: string[];
        loadedModelDevices: Record<string, string>;
        devicePreference: DevicePreference;
      }
    > => {
      const [resources, loadedModelDevices] = await Promise.all([querySystemResources(), loadedServerDevices()]);
      return {
        ...resources,
        loadedModelIds: loadedServerModelIds(),
        loadedModelDevices,
        devicePreference: getDevicePreference(),
      };
    },
  );

  // Settings > System's "Run models on". A server picks its device when it
  // starts, so idle ones are stopped and relaunch on the new device at the
  // next generation; one that's mid-generation finishes where it is.
  ipcMain.handle("kwesi:hardware:getDevicePreference", (): DevicePreference => getDevicePreference());
  ipcMain.handle("kwesi:hardware:setDevicePreference", async (_event, preference: DevicePreference) => {
    setDevicePreference(preference);
    await stopIdleServers();
    return getDevicePreference();
  });
}
