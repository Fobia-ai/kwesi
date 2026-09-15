import { describe, it, expect } from "vitest";
import { parseMidi } from "../midiParser";

// A minimal, hand-built single-track SMF (format 0, 480 ticks/beat) with two
// sequential notes -- built by hand rather than loading a real generated
// file so this test is hermetic and its expected values are exact.
const MINIMAL_MIDI = new Uint8Array([
  // MThd
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
  // MTrk, length 22
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x16,
  0x00, 0x90, 0x3c, 0x64, // delta 0, note on ch0 pitch60 vel100
  0x83, 0x60, 0x80, 0x3c, 0x00, // delta 480, note off ch0 pitch60
  0x00, 0x90, 0x40, 0x5a, // delta 0, note on ch0 pitch64 vel90
  0x81, 0x70, 0x80, 0x40, 0x00, // delta 240, note off ch0 pitch64
  0x00, 0xff, 0x2f, 0x00, // delta 0, end of track meta
]);

describe("parseMidi", () => {
  it("parses ticks-per-beat and track count from the header", () => {
    const result = parseMidi(MINIMAL_MIDI);
    expect(result.ticksPerBeat).toBe(480);
    expect(result.trackCount).toBe(1);
  });

  it("extracts note-on/note-off pairs with correct pitch, timing, and velocity", () => {
    const result = parseMidi(MINIMAL_MIDI);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toMatchObject({ pitch: 60, velocity: 100, startTick: 0, endTick: 480, channel: 0 });
    expect(result.notes[1]).toMatchObject({ pitch: 64, velocity: 90, startTick: 480, endTick: 720, channel: 0 });
  });

  it("computes durationTicks from the last note-off", () => {
    const result = parseMidi(MINIMAL_MIDI);
    expect(result.durationTicks).toBe(720);
  });

  it("throws a clear error for a non-MIDI buffer", () => {
    expect(() => parseMidi(new Uint8Array([0, 1, 2, 3]))).toThrow(/MThd/);
  });

  it("treats a note_on with velocity 0 as a note-off (running status friendly)", () => {
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
      0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0b,
      0x00, 0x90, 0x30, 0x64, // note on pitch48 vel100
      0x60, 0x30, 0x00, // running status: implicit 0x90, pitch48 vel0 (= note off)
      0x00, 0xff, 0x2f, 0x00,
    ]);
    const result = parseMidi(bytes);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ pitch: 48, startTick: 0, endTick: 96 });
  });
});
