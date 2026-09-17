import type { ParsedMidi } from "./midiParser";

// Pure layout/color math shared between the live PianoRollViewer (which
// renders it as themed JSX/Tailwind classes) and the export-image builder
// (which needs the identical note positions and colors baked into a
// self-contained, theme-independent SVG string) -- kept here so the two
// never drift apart.

export const PIXELS_PER_BEAT = 24;
export const DEFAULT_VIEW_HEIGHT = 220;
export const MIN_ROW_HEIGHT = 3;
export const MAX_ROW_HEIGHT = 14;

// True for the 5 semitones that are a piano's black keys (C#, D#, F#, G#, A#).
export const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(pitch: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

// Real, physical chromatic Boomwhacker / music-education note-color
// convention (C=red through B=violet) -- see PianoRollViewer.tsx's own
// note on why this isn't an even 30°-per-semitone hue wheel.
// Index = pitch class (0=C ... 11=B).
export const PITCH_CLASS_HUES = [0, 18, 32, 45, 55, 85, 140, 172, 197, 217, 255, 285];

export function noteColor(pitch: number, velocity: number): string {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const hue = PITCH_CLASS_HUES[pitchClass];
  const loudness = velocity / 127;
  const saturation = 62 + loudness * 25;
  const lightness = 48 + loudness * 14;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export interface PianoRollLayout {
  minPitch: number;
  maxPitch: number;
  pitchCount: number;
  rowHeight: number;
  width: number;
  height: number;
  beats: number;
  ticksPerBeat: number;
  pitches: number[];
}

export function computePianoRollLayout(midi: ParsedMidi, viewHeight: number): PianoRollLayout {
  const { notes, ticksPerBeat, durationTicks } = midi;

  let minPitch = 48;
  let maxPitch = 72;
  if (notes.length > 0) {
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      if (n.pitch < lo) lo = n.pitch;
      if (n.pitch > hi) hi = n.pitch;
    }
    minPitch = Math.max(0, lo - 2);
    maxPitch = Math.min(127, hi + 2);
  }

  const pitchCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, viewHeight / pitchCount));
  const height = Math.round(pitchCount * rowHeight);
  const beats = Math.max(1, durationTicks / (ticksPerBeat || 480));
  const width = Math.max(320, beats * PIXELS_PER_BEAT);
  const pitches = Array.from({ length: pitchCount }, (_, i) => minPitch + i);

  return { minPitch, maxPitch, pitchCount, rowHeight, width, height, beats, ticksPerBeat: ticksPerBeat || 480, pitches };
}

export function tickToX(tick: number, ticksPerBeat: number): number {
  return (tick / (ticksPerBeat || 480)) * PIXELS_PER_BEAT;
}

export function pitchToY(pitch: number, layout: PianoRollLayout): number {
  return layout.height - (pitch - layout.minPitch + 1) * layout.rowHeight;
}
