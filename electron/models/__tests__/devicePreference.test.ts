import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories.js", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

import { serverDeviceEnv } from "../devicePreference";
import { parseVmStatAvailableBytes } from "../gpuInfo";

describe("serverDeviceEnv", () => {
  it("leaves every device visible in automatic mode", () => {
    expect(serverDeviceEnv("auto", "linux")).toEqual({ KWESI_DEVICE: "auto" });
  });

  it("hides the GPU from every kind of server in CPU-only mode", () => {
    expect(serverDeviceEnv("cpu", "win32")).toEqual({ KWESI_DEVICE: "cpu", ACESTEP_DEVICE: "cpu", CUDA_VISIBLE_DEVICES: "" });
  });

  it("lets Metal fall back to the CPU for operations it lacks, on a Mac", () => {
    expect(serverDeviceEnv("auto", "darwin")).toEqual({ KWESI_DEVICE: "auto", PYTORCH_ENABLE_MPS_FALLBACK: "1" });
  });
});

describe("parseVmStatAvailableBytes", () => {
  const sample = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                               10000.",
    "Pages active:                            400000.",
    "Pages inactive:                          200000.",
    "Pages speculative:                         5000.",
    "Pages wired down:                        150000.",
  ].join("\n");

  it("adds free, inactive and speculative pages", () => {
    expect(parseVmStatAvailableBytes(sample)).toBe((10000 + 200000 + 5000) * 16384);
  });

  it("returns null for output it can't read", () => {
    expect(parseVmStatAvailableBytes("not vm_stat")).toBeNull();
  });
});
