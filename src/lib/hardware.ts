export interface GpuVramInfo {
  available: boolean;
  totalVramGb: number;
  freeVramGb: number;
  gpuName?: string;
}

export interface KwesiHardwareApi {
  gpuVram(): Promise<GpuVramInfo>;
}

function realHardwareApi(bridge: NonNullable<Window["kwesi"]>["hardware"]): KwesiHardwareApi {
  return {
    gpuVram: () => bridge.gpuVram(),
  };
}

/**
 * A plausible fixed value (24GB card, ~19GB free) so the hardware-gating UI
 * is exercisable during a plain browser preview with no Electron/real
 * `nvidia-smi` involved — this dev machine's actual RTX 3090, roughly idle.
 */
function createMockHardwareApi(): KwesiHardwareApi {
  return {
    async gpuVram() {
      return { available: true, totalVramGb: 24, freeVramGb: 19, gpuName: "Mock GPU (browser preview)" };
    },
  };
}

export const kwesiHardware: KwesiHardwareApi = window.kwesi?.hardware
  ? realHardwareApi(window.kwesi.hardware)
  : createMockHardwareApi();
