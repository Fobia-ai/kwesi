import { describe, it, expect } from "vitest";
import { abcToMidiBytes } from "../abcToMidi";
import { parseMidi } from "../midiParser";

describe("abcToMidiBytes", () => {
  it("produces real, parseable Standard MIDI File bytes from ABC text", () => {
    const abc = "X:1\nT:Test\nM:4/4\nL:1/8\nK:C\nCDEF GABc |";
    const bytes = abcToMidiBytes(abc);
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!.slice(0, 4))).toBe("MThd");
    // round-trips through this app's own MIDI parser with real notes.
    const parsed = parseMidi(bytes!);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it("never throws on degenerate input -- abcjs parses leniently rather than rejecting it", () => {
    // abcjs's real behavior: garbage/empty ABC still yields a minimal valid
    // (musically empty) MIDI file rather than an error. abcToMidiBytes's
    // try/catch is a safety net for whatever abcjs edge case *would* throw,
    // not something exercised by ordinary bad input.
    expect(() => abcToMidiBytes("not abc at all { } garbage")).not.toThrow();
    const bytes = abcToMidiBytes("");
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!.slice(0, 4))).toBe("MThd");
  });
});
