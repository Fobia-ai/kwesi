import { describe, expect, it } from "vitest";
import { DEVICE_SUPPORT } from "../deviceSupport";
import { MANIFESTS } from "../manifests";

describe("DEVICE_SUPPORT", () => {
  it("has exactly one row for every model", () => {
    expect(DEVICE_SUPPORT.map((row) => row.modelId).sort()).toEqual(Object.keys(MANIFESTS).sort());
  });

  it("agrees with each manifest about Apple GPU and CPU support", () => {
    for (const row of DEVICE_SUPPORT) {
      const { hardware } = MANIFESTS[row.modelId];
      // A model flagged for Apple's GPU must not be listed as unsupported there, and vice versa.
      expect(row.apple.level === "yes" || row.apple.level === "partial", row.modelId).toBe(Boolean(hardware.appleGpu));
      // A model with a real CPU path is never listed as "no" on the CPU.
      if (hardware.cpuFallback) expect(row.cpu.level, row.modelId).not.toBe("no");
    }
  });
});
