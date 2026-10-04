import { describe, expect, it } from "vitest";
import { estimateTrainingSeconds, formatEstimate } from "../trainingEstimate";

const ctx = { fileCount: 3, museCocoOnGpu: true };

describe("estimateTrainingSeconds", () => {
  it("matches the measured quick-test runs", () => {
    // Measured end to end on an RTX 3090: RAVE 60 steps ~15-40s, ACE-Step 3x3 ~70s with preview.
    expect(estimateTrainingSeconds("rave", { max_steps: 60, batch_size: 4, config: "v2_small" }, ctx)).toBeLessThan(60);
    expect(estimateTrainingSeconds("ace-step-1.5", { epochs: 3, rank: 8 }, ctx)).toBeLessThan(120);
  });

  it("scales with the work requested", () => {
    const quick = estimateTrainingSeconds("musicgen", { epochs: 1, base_variant: "small" }, ctx)!;
    const long = estimateTrainingSeconds("musicgen", { epochs: 40, base_variant: "small" }, ctx)!;
    const medium = estimateTrainingSeconds("musicgen", { epochs: 40, base_variant: "medium" }, ctx)!;
    expect(long).toBeGreaterThan(quick * 10);
    expect(medium).toBeGreaterThan(long * 4);
  });

  it("knows MuseCoco on the CPU is ~50x slower", () => {
    const gpu = estimateTrainingSeconds("musecoco", { max_updates: 300 }, ctx)!;
    const cpu = estimateTrainingSeconds("musecoco", { max_updates: 300 }, { ...ctx, museCocoOnGpu: false })!;
    expect(cpu / gpu).toBeGreaterThan(30);
  });

  it("returns null for models it can't estimate", () => {
    expect(estimateTrainingSeconds("museformer", {}, ctx)).toBeNull();
  });
});

describe("formatEstimate", () => {
  it("picks a readable unit", () => {
    expect(formatEstimate(23)).toBe("~20 s");
    expect(formatEstimate(300)).toBe("~5 min");
    expect(formatEstimate(5400)).toBe("~1.5 h");
    expect(formatEstimate(7200)).toBe("~2 h");
  });
});
