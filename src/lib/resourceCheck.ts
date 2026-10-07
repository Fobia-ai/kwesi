import type { DevicePreference, SystemResources } from "./hardware";

/**
 * Answers one question for the resource card: can this machine run this
 * checkpoint right now, and on what? Pure, so it's testable without a GPU.
 *
 * Only one case blocks: no GPU at all and no CPU path, which is certain to
 * fail. Everything else is an estimate (a model's memory figure is a
 * documented minimum, and other apps' memory use comes and goes), so it
 * warns and leaves the decision to the user.
 */

export type ResourceLevel = "checking" | "ok" | "warn" | "block";

/** What the track runs on, in the user's terms. */
export type RunDevice = "nvidia" | "apple" | "cpu";

export interface ResourceVerdict {
  level: ResourceLevel;
  headline: string;
  detail?: string;
  /** Unset while still checking. */
  device?: RunDevice;
}

export interface ResourceCheckInput {
  displayName: string;
  cpuFallback: boolean;
  /** The model can use Apple silicon's GPU (Metal). */
  appleGpu?: boolean;
  /** What the chosen checkpoint needs, in GB. 0 means no GPU requirement. */
  requiredVramGb: number;
  resources: SystemResources | null;
  /** The model's server is already up, so its weights are already in memory. */
  modelLoaded: boolean;
  /** What the loaded model reports it's on ("cuda" / "mps" / "cpu"), if it says. */
  loadedDevice?: string;
  /** Display names of other models Kwesi has loaded right now. */
  otherLoadedModels?: string[];
  /** The track is generating right now, so the question is already answered. */
  generating?: boolean;
  /** Settings > System's "Run models on". */
  devicePreference?: DevicePreference;
}

export function formatGb(gb: number): string {
  return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
}

export const DEVICE_LABEL: Record<RunDevice, string> = {
  nvidia: "NVIDIA GPU",
  apple: "Apple GPU",
  cpu: "CPU",
};

function fromReported(device: string | undefined): RunDevice | undefined {
  if (device === "cuda") return "nvidia";
  if (device === "mps") return "apple";
  if (device === "cpu") return "cpu";
  return undefined;
}

export function assessResources(input: ResourceCheckInput): ResourceVerdict {
  const { displayName, cpuFallback, requiredVramGb, resources, modelLoaded } = input;
  if (!resources) return { level: "checking", headline: "Checking your hardware…" };

  const { gpu } = resources;
  const cpuOnly = (input.devicePreference ?? resources.devicePreference) === "cpu";
  const gpuDevice: RunDevice | null =
    gpu.kind === "nvidia" ? "nvidia" : gpu.kind === "apple" && input.appleGpu ? "apple" : null;
  // What it will run on -- or, once loaded, what the model itself reports.
  const device: RunDevice = fromReported(input.loadedDevice) ?? (cpuOnly ? "cpu" : (gpuDevice ?? "cpu"));
  const need = formatGb(requiredVramGb);

  if (input.generating) {
    return { level: "ok", headline: `${displayName} is generating`, detail: "The meters show what it's using right now.", device };
  }

  // Its memory is already counted as "used", so comparing the requirement
  // against what's free would wrongly look like a shortfall.
  if (modelLoaded) {
    return {
      level: "ok",
      headline: `${displayName} is loaded and ready`,
      detail: "It's already in memory, so generation starts right away.",
      device,
    };
  }

  if (cpuOnly) {
    return cpuFallback || requiredVramGb <= 0
      ? {
          level: "ok",
          headline: "Runs on your CPU",
          detail: "You've set Kwesi to CPU only in Settings. It will be slower than a GPU.",
          device,
        }
      : {
          level: "warn",
          headline: "Runs on your CPU, which this model isn't built for",
          detail: `You've set Kwesi to CPU only in Settings. ${displayName} is made for a GPU, so it may be very slow or fail.`,
          device,
        };
  }

  if (!gpu.available) {
    if (requiredVramGb > 0 && !cpuFallback) {
      return {
        level: "block",
        headline: "This model needs an NVIDIA GPU",
        detail: `${displayName} needs about ${need} of GPU memory and can't run on the CPU. No GPU was found on this machine.`,
        device,
      };
    }
    return {
      level: "warn",
      headline: "No GPU found — this will run on the CPU",
      detail: "It will work, but much more slowly than on a GPU.",
      device,
    };
  }

  // A Mac whose GPU this model can't use.
  if (!gpuDevice) {
    if (requiredVramGb <= 0) {
      return { level: "ok", headline: "Your machine can handle this", detail: `${displayName} runs on the CPU.`, device };
    }
    return cpuFallback
      ? {
          level: "warn",
          headline: "Runs on the CPU on this Mac",
          detail: `${displayName} can't use Apple's GPU. It will work, but slowly.`,
          device,
        }
      : {
          level: "block",
          headline: "This model needs an NVIDIA GPU",
          detail: `${displayName} can't use Apple's GPU and can't run on the CPU.`,
          device,
        };
  }

  if (requiredVramGb <= 0) {
    return {
      level: "ok",
      headline: "Your machine can handle this",
      detail: `${displayName} has no minimum GPU memory.`,
      device,
    };
  }

  const shared = gpu.kind === "apple";
  const memory = shared ? "memory" : "GPU memory";

  if (gpu.totalVramGb < requiredVramGb) {
    return {
      level: "warn",
      headline: shared ? "This Mac doesn't have enough memory for this checkpoint" : "Your GPU is too small for this checkpoint",
      detail: `It needs about ${need}, and ${shared ? "this Mac" : "your GPU"} has ${formatGb(gpu.totalVramGb)} in total. ${
        cpuFallback && !shared ? "It may fall back to the CPU and run slowly, or fail." : "It will probably fail."
      }`,
      device,
    };
  }

  if (gpu.freeVramGb < requiredVramGb) {
    const others = input.otherLoadedModels ?? [];
    const cause =
      others.length > 0
        ? `${others.join(" and ")} ${others.length === 1 ? "is" : "are"} still loaded in Kwesi and holding ${memory}.`
        : shared
          ? "Close other apps to free some up."
          : "Close other apps that are using the GPU to free some up.";
    return {
      level: "warn",
      headline: `Not enough free ${memory} right now`,
      detail: `It needs about ${need}, and only ${formatGb(gpu.freeVramGb)} is free. ${cause} Otherwise it may fail or run slowly.`,
      device,
    };
  }

  return {
    level: "ok",
    headline: shared ? "Your Mac's GPU can handle this" : "Your GPU can handle this",
    detail: `It needs about ${need}, and ${formatGb(gpu.freeVramGb)} is free.`,
    device,
  };
}
