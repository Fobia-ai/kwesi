import type { ParsedMidi } from "./midiParser";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function pitchName(pitch: number): string {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1; // scientific pitch notation, middle C = C4
  return `${NOTE_NAMES[pitchClass]}${octave}`;
}

function col(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

// The "Midi.txt" tab / export sidecar -- raw SMF bytes aren't text, so this
// is a readable per-note event listing (one row per note-on/note-off pair)
// rather than a literal transcription of the file.
export function midiToText(midi: ParsedMidi, title = "Untitled"): string {
  const lines = [
    title,
    `ticks/beat: ${midi.ticksPerBeat}  tracks: ${midi.trackCount}  notes: ${midi.notes.length}`,
    "",
    col("track", 6) + col("start(beat)", 12) + col("dur(beat)", 10) + col("pitch", 7) + col("note", 6) + "velocity",
  ];

  const sorted = [...midi.notes].sort((a, b) => a.startTick - b.startTick || a.track - b.track);
  for (const n of sorted) {
    const startBeat = (n.startTick / midi.ticksPerBeat).toFixed(2);
    const durBeat = ((n.endTick - n.startTick) / midi.ticksPerBeat).toFixed(2);
    lines.push(
      col(n.track, 6) + col(startBeat, 12) + col(durBeat, 10) + col(n.pitch, 7) + col(pitchName(n.pitch), 6) + n.velocity,
    );
  }

  return lines.join("\n");
}
