import { useEffect, useState } from "react";
import type { SystemResources } from "./kwesiBridge";

export type { SystemResources } from "./kwesiBridge";

export interface GpuVramInfo {
  available: boolean;
  totalVramGb: number;
  freeVramGb: number;
  gpuName?: string;
}

export interface KwesiHardwareApi {
  gpuVram(): Promise<GpuVramInfo>;
  /** Live GPU and system memory, and which models Kwesi has loaded. */
  resources(): Promise<SystemResources>;
}

function realHardwareApi(bridge: NonNullable<Window["kwesi"]>["hardware"]): KwesiHardwareApi {
  return {
    gpuVram: () => bridge.gpuVram(),
    resources: () => bridge.resources(),
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
    async resources() {
      return {
        gpu: {
          available: true,
          name: "Mock GPU (browser preview)",
          totalVramGb: 24,
          usedVramGb: 5,
          freeVramGb: 19,
          utilizationPct: 3,
        },
        ram: { totalGb: 64, freeGb: 41 },
        loadedModelIds: [],
      };
    },
  };
}

export const kwesiHardware: KwesiHardwareApi = window.kwesi?.hardware
  ? realHardwareApi(window.kwesi.hardware)
  : createMockHardwareApi();

/**
 * A live resources snapshot, refreshed every `intervalMs` while mounted
 * (null until the first one lands). Polling pauses while the window is
 * hidden -- nobody is looking at the meters then.
 */
export function useSystemResources(intervalMs = 2000): SystemResources | null {
  const [resources, setResources] = useState<SystemResources | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (document.hidden) return;
      kwesiHardware
        .resources()
        .then((next) => {
          if (!cancelled) setResources(next);
        })
        .catch(() => {
          // Keep the last good snapshot; the next tick tries again.
        });
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return resources;
}
