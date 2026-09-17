import { describe, it, expect } from "vitest";
import { midiToText } from "../midiTextDump";
import type { ParsedMidi } from "../midiParser";

describe("midiToText", () => {
  it("lists notes sorted by start time with pitch name, beat position, and duration", () => {
    const midi: ParsedMidi = {
      ticksPerBeat: 480,
      durationTicks: 960,
      trackCount: 1,
      notes: [
        { pitch: 64, velocity: 90, startTick: 480, endTick: 720, channel: 0, track: 0 },
        { pitch: 60, velocity: 100, startTick: 0, endTick: 480, channel: 0, track: 0 },
      ],
    };
    const text = midiToText(midi, "My Track");
    const lines = text.split("\n");
    expect(lines[0]).toBe("My Track");
    expect(lines[1]).toContain("ticks/beat: 480");
    expect(lines[1]).toContain("notes: 2");
    // sorted by start time, so pitch 60 (starts at beat 0) comes first
    const dataLines = lines.slice(4);
    expect(dataLines[0]).toContain("C4");
    expect(dataLines[1]).toContain("E4");
  });
});
