import { describe, it, expect } from "vitest";
import { buildDemoMidi, buildSilentWav, kwesiAudio } from "../audio";
import { parseMidi } from "../midiParser";

describe("buildSilentWav", () => {
  it("produces a valid RIFF/WAVE header", () => {
    const bytes = buildSilentWav(8000, 1);
    const text = (offset: number, len: number) => String.fromCharCode(...bytes.subarray(offset, offset + len));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(text(36, 4)).toBe("data");
  });

  it("sizes the data chunk from sample rate and duration", () => {
    const bytes = buildSilentWav(8000, 1);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(40, true)).toBe(8000 * 2);
    expect(bytes.byteLength).toBe(44 + 8000 * 2);
  });

  it("declares a 16-bit mono PCM format", () => {
    const bytes = buildSilentWav(8000, 1);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
  });
});

describe("kwesiAudio (browser-preview mock)", () => {
  it("reports a non-empty stat so the player renders instead of an empty state", async () => {
    const stat = await kwesiAudio.stat("/mock/generations/g1/output.wav");
    expect(stat.exists).toBe(true);
    expect(stat.sizeBytes).toBeGreaterThan(0);
  });

  it("reads playable bytes with a wav mime type", async () => {
    const result = await kwesiAudio.read("/mock/generations/g1/output.wav");
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe("audio/wav");
    expect(result.bytes && result.bytes.byteLength).toBeGreaterThan(0);
  });

  // Regression: the mock used to answer every read with WAV bytes, so the
  // piano roll rejected every MIDI generation in the browser preview with
  // "Couldn't parse this MIDI file".
  it("serves real, parseable MIDI bytes for a .mid path", async () => {
    const result = await kwesiAudio.read("/mock/generations/g1/output.mid");
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe("audio/midi");
    const parsed = parseMidi(result.bytes as Uint8Array);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it("save resolves ok without touching any real filesystem", async () => {
    const result = await kwesiAudio.save("/mock/generations/g1/output.wav", "song.wav", "export");
    expect(result.ok).toBe(true);
  });

  it("reveal resolves ok", async () => {
    const result = await kwesiAudio.reveal("/mock/generations/g1/output.wav");
    expect(result.ok).toBe(true);
  });
});

describe("buildDemoMidi", () => {
  it("is a format-0 SMF the real parser reads notes out of", () => {
    const parsed = parseMidi(buildDemoMidi());
    expect(parsed.trackCount).toBe(1);
    expect(parsed.ticksPerBeat).toBe(480);
    expect(parsed.notes).toHaveLength(16);
    // Notes are sequential and separated, not one overlapping smear.
    expect(parsed.notes[0].endTick).toBeLessThan(parsed.notes[1].startTick);
    expect(parsed.durationTicks).toBeGreaterThan(0);
  });
});
