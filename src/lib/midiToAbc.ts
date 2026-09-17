import type { MidiNote, ParsedMidi } from "./midiParser";

// Turns already-parsed MIDI notes into real, playable ABC notation text so
// MIDI-only outputs (MuseCoco, Museformer) can share the same ABC viewer as
// YuE2's native score.abc. No npm package does this well for our case —
// the one real option (marmooo/midi2abc) is a Magenta.js/Tone.js browser
// demo, not an importable library, and pulls in a TensorFlow.js dependency
// for what is, given notes we've already parsed, a straightforward
// quantize-and-notate pass. abcjs (a real dependency, see AbcNotationRenderer)
// is used for the part that's genuinely hard to reimplement: engraving.
//
// Honest limitations of this transcription, so nobody mistakes it for a
// full transcriber: it always writes 4/4 at a fixed sixteenth-note grid
// (no time-signature/tempo meta is parsed by midiParser.ts to do better),
// always uses K:C with inline accidentals instead of detecting a real key,
// and reduces each track to one voice by truncating a note early if
// another note in the same track starts before it ends (real notation
// software handles that with tied notes across a second voice; this
// doesn't). None of that makes the output wrong to read or play, just not
// engraver-quality.

const PITCH_CLASS_ABC = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];

function pitchToAbc(pitch: number): string {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const scientificOctave = Math.floor(pitch / 12) - 1;
  // ABC's "bare capital letter" register is the octave containing middle C
  // (scientific octave 4, MIDI 60-71) -- everything else is expressed
  // relative to that with case + trailing , or ' marks.
  const relOctave = scientificOctave - 4;
  const entry = PITCH_CLASS_ABC[pitchClass];
  const isSharp = entry.startsWith("^");
  const letter = isSharp ? entry.slice(1) : entry;
  const cased = relOctave > 0 ? letter.toLowerCase() : letter;
  const suffix = relOctave === 0 ? "" : relOctave > 0 ? "'".repeat(relOctave - 1) : ",".repeat(-relOctave);
  return `${isSharp ? "^" : ""}${cased}${suffix}`;
}

interface QuantizedNote {
  startUnit: number;
  endUnit: number;
  pitch: number;
}

const UNITS_PER_BAR = 16; // fixed 4/4 at L:1/16 -> 4 beats * 4 sixteenths

function quantize(notes: MidiNote[], grid: number): QuantizedNote[] {
  return notes
    .map((n) => {
      const startUnit = Math.round(n.startTick / grid);
      const endUnit = Math.max(startUnit + 1, Math.round(n.endTick / grid));
      return { startUnit, endUnit, pitch: n.pitch };
    })
    .sort((a, b) => a.startUnit - b.startUnit);
}

function trackToAbcLine(notes: QuantizedNote[]): string {
  const groups = new Map<number, QuantizedNote[]>();
  for (const n of notes) {
    const arr = groups.get(n.startUnit);
    if (arr) arr.push(n);
    else groups.set(n.startUnit, [n]);
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);

  const tokens: string[] = [];
  let cursor = 0;
  let unitsInBar = 0;

  function push(token: string, durationUnits: number) {
    tokens.push(token);
    unitsInBar += durationUnits;
    while (unitsInBar >= UNITS_PER_BAR) {
      tokens.push("|");
      unitsInBar -= UNITS_PER_BAR;
    }
  }

  for (const start of starts) {
    if (start < cursor) continue; // swallowed by the previous chord's duration -- see file-level note on monophonic-per-track reduction
    if (start > cursor) {
      const gap = start - cursor;
      push(gap > 1 ? `z${gap}` : "z", gap);
    }
    const chord = groups.get(start)!;
    const duration = Math.max(1, Math.min(...chord.map((n) => n.endUnit)) - start);
    const pitches = [...new Set(chord.map((n) => n.pitch))].sort((a, b) => a - b);
    const body = pitches.length === 1 ? pitchToAbc(pitches[0]) : `[${pitches.map(pitchToAbc).join("")}]`;
    push(`${body}${duration > 1 ? duration : ""}`, duration);
    cursor = start + duration;
  }

  return tokens.join(" ");
}

function sanitizeHeaderText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function midiToAbc(midi: ParsedMidi, title = "Untitled"): string {
  const grid = Math.max(1, Math.round(midi.ticksPerBeat / 4));
  const byTrack = new Map<number, MidiNote[]>();
  for (const note of midi.notes) {
    const arr = byTrack.get(note.track);
    if (arr) arr.push(note);
    else byTrack.set(note.track, [note]);
  }
  const trackIds = [...byTrack.keys()].sort((a, b) => a - b);

  const header = [`X:1`, `T:${sanitizeHeaderText(title) || "Untitled"}`, `M:4/4`, `L:1/16`, `K:C`];

  const body: string[] =
    trackIds.length <= 1
      ? [trackToAbcLine(quantize(midi.notes, grid))]
      : trackIds.flatMap((trackId) => [`V:${trackId + 1}`, trackToAbcLine(quantize(byTrack.get(trackId)!, grid))]);

  return [...header, ...body].join("\n");
}
