import { describe, expect, it } from "vitest";
import { validateDataset, type ClipProbe } from "../datasetCheck";
import type { TrainingDatasetRequirements } from "../../data/manifests";

const RAVE: TrainingDatasetRequirements = { fileTypes: [".wav"], minFiles: 3, minTotalDurationMin: 1, requiresCaptions: false };
const MUSICGEN: TrainingDatasetRequirements = {
  fileTypes: [".wav"],
  minFiles: 2,
  minTotalDurationMin: 0.5,
  requiresCaptions: true,
  recommendedMinClipSec: 30,
  shortClipReason: "Pads with silence.",
};
const ACE: TrainingDatasetRequirements = { ...MUSICGEN, recommendedMinClipSec: undefined, maxClipSec: 240, longClipReason: "Trims." };

const ok = (durationSec: number): ClipProbe => ({ status: "ok", durationSec });
const files = (...n: string[]) => n.map((name) => ({ name }));

describe("validateDataset", () => {
  it("passes a dataset that meets every rule", () => {
    const r = validateDataset(files("a.wav", "b.wav", "c.wav"), [ok(30), ok(30), ok(30)], RAVE);
    expect(r.blocking).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.totalSec).toBe(90);
  });

  it("blocks below the minimum clip count and total duration", () => {
    const r = validateDataset(files("a.wav", "b.wav"), [ok(10), ok(10)], RAVE);
    expect(r.blocking).toBe(true);
    expect(r.issues.map((i) => i.message)).toEqual([
      "Needs at least 3 audio clips (have 2).",
      "Needs at least 1:00 of audio in total (have 0:20).",
    ]);
  });

  it("blocks empty and unreadable files", () => {
    const r = validateDataset(
      files("a.wav", "b.wav", "c.wav", "d.wav"),
      [ok(60), { status: "empty", durationSec: 0 }, { status: "unreadable", durationSec: null }, ok(10)],
      RAVE,
    );
    expect(r.blocking).toBe(true);
    expect(r.issues.filter((i) => i.tone === "error").map((i) => i.message)).toEqual([
      "b.wav is empty.",
      "Couldn't read c.wav — it may be corrupt or not really audio. Remove or re-export it.",
    ]);
  });

  it("only warns about the total when some lengths can't be measured", () => {
    const r = validateDataset(files("a.wav", "b.wav", "c.aiff"), [ok(10), ok(10), { status: "unknown", durationSec: null }], RAVE);
    expect(r.blocking).toBe(false);
    expect(r.issues.every((i) => i.tone === "warning")).toBe(true);
  });

  it("warns about clips shorter than the model trains on", () => {
    const r = validateDataset(files("a.wav", "b.wav"), [ok(12), ok(45)], MUSICGEN);
    expect(r.blocking).toBe(false);
    expect(r.issues).toEqual([{ tone: "warning", message: "1 clip is shorter than 0:30. Pads with silence." }]);
  });

  it("warns about clips longer than the model uses", () => {
    const r = validateDataset(files("a.wav", "b.wav"), [ok(300), ok(60)], ACE);
    expect(r.issues).toEqual([{ tone: "warning", message: "1 clip is longer than 4:00. Trims." }]);
  });

  it("warns about duplicate file names", () => {
    const r = validateDataset(files("a.wav", "a.wav"), [ok(40), ok(40)], ACE);
    expect(r.issues[0].message).toContain("More than one file is named a.wav");
  });
});
