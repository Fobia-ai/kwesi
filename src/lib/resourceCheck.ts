import type { SystemResources } from "./hardware";

/**
 * Answers one question for the resource card: can this machine run this
 * checkpoint right now? Pure, so it's testable without a GPU.
 *
 * Only one case blocks: no GPU at all and no CPU path, which is certain to
 * fail. Everything else is an estimate (a model's VRAM figure is a documented
 * minimum, and other apps' GPU memory comes and goes), so it warns and leaves
 * the decision to the user.
 */

export type ResourceLevel = "checking" | "ok" | "warn" | "block";

export interface ResourceVerdict {
  level: ResourceLevel;
  headline: string;
  detail?: string;
}

export interface ResourceCheckInput {
  displayName: string;
  cpuFallback: boolean;
  /** What the chosen checkpoint needs, in GB. 0 means no GPU requirement. */
  requiredVramGb: number;
  resources: SystemResources | null;
  /** The model's server is already up, so its weights are already in memory. */
  modelLoaded: boolean;
  /** Display names of other models Kwesi has loaded right now. */
  otherLoadedModels?: string[];
  /** The track is generating right now, so the question is already answered. */
  generating?: boolean;
}

export function formatGb(gb: number): string {
  return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
}

export function assessResources(input: ResourceCheckInput): ResourceVerdict {
  const { displayName, cpuFallback, requiredVramGb, resources, modelLoaded } = input;
  if (!resources) return { level: "checking", headline: "Checking your hardware…" };

  if (input.generating) {
    return { level: "ok", headline: `${displayName} is generating`, detail: "The meters show what it's using right now." };
  }

  // Its memory is already counted as "used", so comparing the requirement
  // against what's free would wrongly look like a shortfall.
  if (modelLoaded) {
    return {
      level: "ok",
      headline: `${displayName} is loaded and ready`,
      detail: "It's already in memory, so generation starts right away.",
    };
  }

  const { gpu } = resources;
  const need = formatGb(requiredVramGb);

  if (!gpu.available) {
    if (requiredVramGb > 0 && !cpuFallback) {
      return {
        level: "block",
        headline: "This model needs an NVIDIA GPU",
        detail: `${displayName} needs about ${need} of GPU memory and can't run on the CPU. No GPU was found on this machine.`,
      };
    }
    return {
      level: "warn",
      headline: "No GPU found — this will run on the CPU",
      detail: "It will work, but much more slowly than on a GPU.",
    };
  }

  if (requiredVramGb <= 0) {
    return {
      level: "ok",
      headline: "Your machine can handle this",
      detail: `${displayName} has no minimum GPU memory.`,
    };
  }

  if (gpu.totalVramGb < requiredVramGb) {
    return {
      level: "warn",
      headline: "Your GPU is too small for this checkpoint",
      detail: `It needs about ${need}, and your GPU has ${formatGb(gpu.totalVramGb)} in total. ${
        cpuFallback ? "It may fall back to the CPU and run slowly, or fail." : "It will probably fail."
      }`,
    };
  }

  if (gpu.freeVramGb < requiredVramGb) {
    const others = input.otherLoadedModels ?? [];
    const cause =
      others.length > 0
        ? `${others.join(" and ")} ${others.length === 1 ? "is" : "are"} still loaded in Kwesi and holding GPU memory.`
        : "Close other apps that are using the GPU to free some up.";
    return {
      level: "warn",
      headline: "Not enough free GPU memory right now",
      detail: `It needs about ${need}, and only ${formatGb(gpu.freeVramGb)} is free. ${cause} Otherwise it may fail or run slowly.`,
    };
  }

  return {
    level: "ok",
    headline: "Your GPU can handle this",
    detail: `It needs about ${need}, and ${formatGb(gpu.freeVramGb)} is free.`,
  };
}
