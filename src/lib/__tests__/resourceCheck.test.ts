import { describe, expect, it } from "vitest";
import { assessResources, formatGb, type ResourceCheckInput } from "../resourceCheck";
import type { SystemResources } from "../hardware";

function resources(gpu: Partial<SystemResources["gpu"]> = {}): SystemResources {
  return {
    gpu: { available: true, kind: "nvidia", name: "Test GPU", totalVramGb: 24, usedVramGb: 4, freeVramGb: 20, utilizationPct: 0, ...gpu },
    ram: { totalGb: 64, freeGb: 40 },
    loadedModelIds: [],
    loadedModelDevices: {},
    devicePreference: "auto",
  };
}

function assess(overrides: Partial<ResourceCheckInput> = {}) {
  return assessResources({
    displayName: "ACE-Step 1.5",
    cpuFallback: false,
    requiredVramGb: 6,
    resources: resources(),
    modelLoaded: false,
    ...overrides,
  });
}

describe("assessResources", () => {
  it("is still checking until the first snapshot lands", () => {
    expect(assess({ resources: null }).level).toBe("checking");
  });

  it("says the GPU can handle it when enough memory is free", () => {
    const verdict = assess();
    expect(verdict.level).toBe("ok");
    expect(verdict.detail).toContain("6 GB");
    expect(verdict.detail).toContain("20 GB is free");
  });

  it("warns when the GPU is big enough but too full right now", () => {
    const verdict = assess({ resources: resources({ usedVramGb: 21, freeVramGb: 3 }) });
    expect(verdict.level).toBe("warn");
    expect(verdict.headline).toMatch(/right now/);
    expect(verdict.detail).toContain("Close other apps");
  });

  it("names the other Kwesi model holding the memory", () => {
    const verdict = assess({ resources: resources({ usedVramGb: 21, freeVramGb: 3 }), otherLoadedModels: ["MusicGen"] });
    expect(verdict.detail).toContain("MusicGen is still loaded in Kwesi");
  });

  it("warns when the whole GPU is smaller than the checkpoint needs", () => {
    const verdict = assess({ requiredVramGb: 12, resources: resources({ totalVramGb: 8, usedVramGb: 1, freeVramGb: 7 }) });
    expect(verdict.level).toBe("warn");
    expect(verdict.headline).toMatch(/too small/);
  });

  it("doesn't count a loaded model's own memory against it", () => {
    const verdict = assess({ modelLoaded: true, resources: resources({ usedVramGb: 22, freeVramGb: 2 }) });
    expect(verdict.level).toBe("ok");
    expect(verdict.headline).toMatch(/loaded and ready/);
  });

  it("blocks only when there is no GPU and no CPU path", () => {
    const noGpu = resources({ available: false, kind: "none", totalVramGb: 0, usedVramGb: 0, freeVramGb: 0 });
    expect(assess({ resources: noGpu }).level).toBe("block");
    expect(assess({ resources: noGpu, cpuFallback: true }).level).toBe("warn");
    expect(assess({ resources: noGpu, cpuFallback: true }).headline).toMatch(/CPU/);
  });

  it("is fine for a model with no GPU requirement", () => {
    expect(assess({ requiredVramGb: 0, cpuFallback: true }).level).toBe("ok");
  });

  it("reports generating instead of a pre-flight answer once the track runs", () => {
    expect(assess({ generating: true, modelLoaded: true }).headline).toBe("ACE-Step 1.5 is generating");
  });
});

describe("assessResources: choosing a device", () => {
  const mac = resources({ kind: "apple", name: "Apple GPU (Metal)", totalVramGb: 32, usedVramGb: 12, freeVramGb: 20, utilizationPct: null });

  it("plans on the NVIDIA GPU by default", () => {
    expect(assess().device).toBe("nvidia");
  });

  it("keeps everything on the CPU when the user chose CPU only", () => {
    const fine = assess({ devicePreference: "cpu", cpuFallback: true });
    expect(fine.level).toBe("ok");
    expect(fine.device).toBe("cpu");
    expect(fine.headline).toBe("Runs on your CPU");

    const risky = assess({ devicePreference: "cpu", cpuFallback: false });
    expect(risky.level).toBe("warn");
    expect(risky.detail).toContain("made for a GPU");
  });

  it("uses a Mac's GPU for a model that supports Metal, against shared memory", () => {
    const verdict = assess({ resources: mac, appleGpu: true });
    expect(verdict.level).toBe("ok");
    expect(verdict.device).toBe("apple");
    expect(verdict.headline).toBe("Your Mac's GPU can handle this");

    const full = assess({ resources: { ...mac, gpu: { ...mac.gpu, usedVramGb: 29, freeVramGb: 3 } }, appleGpu: true });
    expect(full.level).toBe("warn");
    expect(full.headline).toBe("Not enough free memory right now");
  });

  it("falls back to the CPU on a Mac for a model that can't use Metal", () => {
    const verdict = assess({ resources: mac, cpuFallback: true });
    expect(verdict.level).toBe("warn");
    expect(verdict.device).toBe("cpu");
    expect(verdict.headline).toBe("Runs on the CPU on this Mac");
    expect(assess({ resources: mac, cpuFallback: false }).level).toBe("block");
  });

  it("reports what a loaded model says it's actually on", () => {
    expect(assess({ modelLoaded: true, loadedDevice: "cpu" }).device).toBe("cpu");
    expect(assess({ modelLoaded: true, loadedDevice: "mps", resources: mac, appleGpu: true }).device).toBe("apple");
  });
});

describe("formatGb", () => {
  it("keeps one decimal under 10 GB and rounds above", () => {
    expect(formatGb(0.90625)).toBe("0.9 GB");
    expect(formatGb(6)).toBe("6 GB");
    expect(formatGb(23.09)).toBe("23 GB");
  });
});
