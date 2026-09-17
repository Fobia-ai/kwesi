import { describe, it, expect } from "vitest";
import { midiToAbc } from "../midiToAbc";
import type { ParsedMidi, MidiNote } from "../midiParser";

function note(partial: Partial<MidiNote> & Pick<MidiNote, "pitch" | "startTick" | "endTick">): MidiNote {
  return { velocity: 100, channel: 0, track: 0, ...partial };
}

function midi(notes: MidiNote[], overrides: Partial<ParsedMidi> = {}): ParsedMidi {
  const durationTicks = Math.max(0, ...notes.map((n) => n.endTick));
  return { ticksPerBeat: 480, notes, durationTicks, trackCount: 1, ...overrides };
}

describe("midiToAbc", () => {
  it("emits a header with a fixed 4/4 meter, sixteenth-note unit length, and the given title", () => {
    const abc = midiToAbc(midi([note({ pitch: 60, startTick: 0, endTick: 480 })]), "My Track");
    expect(abc.split("\n").slice(0, 5)).toEqual(["X:1", "T:My Track", "M:4/4", "L:1/16", "K:C"]);
  });

  it("converts sequential notes to duration-suffixed ABC pitches with no gap between them", () => {
    // 480 ticks/beat -> quarter note = 4 sixteenth-note units, eighth = 2.
    const abc = midiToAbc(
      midi([note({ pitch: 60, startTick: 0, endTick: 480 }), note({ pitch: 64, startTick: 480, endTick: 720 })]),
    );
    expect(abc.split("\n").at(-1)).toBe("C4 E2");
  });

  it("inserts a rest to fill a gap between two notes", () => {
    const abc = midiToAbc(
      midi([note({ pitch: 60, startTick: 0, endTick: 240 }), note({ pitch: 64, startTick: 480, endTick: 960 })]),
    );
    expect(abc.split("\n").at(-1)).toBe("C2 z2 E4");
  });

  it("groups simultaneous notes on the same track into a bracketed chord", () => {
    const abc = midiToAbc(
      midi([note({ pitch: 60, startTick: 0, endTick: 480 }), note({ pitch: 64, startTick: 0, endTick: 480 })]),
    );
    expect(abc.split("\n").at(-1)).toBe("[CE]4");
  });

  it("marks sharps and shifts octave register relative to middle C (scientific octave 4)", () => {
    const abc = midiToAbc(
      midi([
        note({ pitch: 61, startTick: 0, endTick: 120 }), // C#4 -> ^C
        note({ pitch: 72, startTick: 120, endTick: 240 }), // C5 -> c
        note({ pitch: 84, startTick: 240, endTick: 360 }), // C6 -> c'
        note({ pitch: 48, startTick: 360, endTick: 480 }), // C3 -> C,
      ]),
    );
    expect(abc.split("\n").at(-1)).toBe("^C c c' C,");
  });

  it("inserts a barline once a track accumulates a full 4/4 bar (16 sixteenth-note units)", () => {
    const abc = midiToAbc(
      midi([note({ pitch: 60, startTick: 0, endTick: 1920 }), note({ pitch: 64, startTick: 1920, endTick: 2400 })]),
    );
    // 1920 ticks = 16 units = a full bar; the note that starts the next bar
    // follows the "|".
    expect(abc.split("\n").at(-1)).toBe("C16 | E4");
  });

  it("emits one V: voice per MIDI track when there's more than one", () => {
    const abc = midiToAbc(
      midi(
        [
          note({ pitch: 60, startTick: 0, endTick: 480, track: 0 }),
          note({ pitch: 67, startTick: 0, endTick: 480, track: 1 }),
        ],
        { trackCount: 2 },
      ),
    );
    expect(abc.split("\n").slice(5)).toEqual(["V:1", "C4", "V:2", "G4"]);
  });
});
