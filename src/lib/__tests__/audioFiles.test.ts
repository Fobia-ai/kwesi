import { describe, it, expect } from "vitest";
import { findAudioFile, findMidiFile, parseOutputFiles, classifyAudioStat, suggestedExportName } from "../audioFiles";

describe("findAudioFile", () => {
  it("finds a wav file among mixed outputs", () => {
    expect(findAudioFile(["/gen/output.mid", "/gen/output.wav"])).toBe("/gen/output.wav");
  });

  it("is case-insensitive", () => {
    expect(findAudioFile(["/gen/OUTPUT.WAV"])).toBe("/gen/OUTPUT.WAV");
  });

  it("returns undefined when no audio extension is present", () => {
    expect(findAudioFile(["/gen/output.mid"])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(findAudioFile([])).toBeUndefined();
  });
});

describe("findMidiFile", () => {
  it("finds a mid file among mixed outputs", () => {
    expect(findMidiFile(["/gen/output.wav", "/gen/output.mid"])).toBe("/gen/output.mid");
  });

  it("matches the .midi extension too", () => {
    expect(findMidiFile(["/gen/output.midi"])).toBe("/gen/output.midi");
  });

  it("is case-insensitive", () => {
    expect(findMidiFile(["/gen/OUTPUT.MID"])).toBe("/gen/OUTPUT.MID");
  });

  it("returns undefined when no midi extension is present", () => {
    expect(findMidiFile(["/gen/output.wav"])).toBeUndefined();
  });
});

describe("parseOutputFiles", () => {
  it("parses a JSON array of strings", () => {
    expect(parseOutputFiles('["/a.wav","/b.mid"]')).toEqual(["/a.wav", "/b.mid"]);
  });

  it("returns an empty array for null/undefined/empty input", () => {
    expect(parseOutputFiles(null)).toEqual([]);
    expect(parseOutputFiles(undefined)).toEqual([]);
    expect(parseOutputFiles("")).toEqual([]);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseOutputFiles("{not json")).toEqual([]);
  });

  it("filters out non-string entries", () => {
    expect(parseOutputFiles('["/a.wav", 42, null]')).toEqual(["/a.wav"]);
  });
});

describe("classifyAudioStat", () => {
  it("is unknown when no stat is available", () => {
    expect(classifyAudioStat(null)).toBe("unknown");
    expect(classifyAudioStat(undefined)).toBe("unknown");
  });

  it("is missing when the file doesn't exist", () => {
    expect(classifyAudioStat({ exists: false, sizeBytes: 0 })).toBe("missing");
  });

  it("is empty for a zero-byte file (the Phase 4 mock placeholder case)", () => {
    expect(classifyAudioStat({ exists: true, sizeBytes: 0 })).toBe("empty");
  });

  it("is ready for a real non-empty file", () => {
    expect(classifyAudioStat({ exists: true, sizeBytes: 128000 })).toBe("ready");
  });
});

describe("suggestedExportName", () => {
  it("keeps the source file's extension", () => {
    expect(suggestedExportName("/gen/output.wav", "My Song")).toBe("My Song.wav");
  });

  it("sanitizes characters unsafe for filenames", () => {
    expect(suggestedExportName("/gen/output.wav", 'Chill: Beats / "v2"')).toBe("Chill- Beats - -v2-.wav");
  });

  it("falls back to a default name when the title is empty", () => {
    expect(suggestedExportName("/gen/output.wav", "   ")).toBe("kwesi-generation.wav");
  });

  it("defaults to .wav when the source path has no extension", () => {
    expect(suggestedExportName("/gen/output", "Track")).toBe("Track.wav");
  });
});
