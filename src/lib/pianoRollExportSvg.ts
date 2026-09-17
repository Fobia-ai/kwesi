import type { ParsedMidi } from "./midiParser";
import { computePianoRollLayout, isBlackKey, noteColor, tickToX, pitchToY, PIXELS_PER_BEAT } from "./pianoRollLayout";

const PADDING = 16;

// A self-contained SVG markup string for the export image -- explicit
// colors baked in (white background, gray gridlines) rather than the live
// PianoRollViewer's Tailwind classes/currentColor, since an exported PNG
// has to look right in any viewer, independent of this app's live theme.
// Uses the exact same layout math and note-color mapping as the on-screen
// viewer (pianoRollLayout.ts) so the exported picture matches what's shown.
export function buildPianoRollExportSvg(midi: ParsedMidi, viewHeight = 320): string {
  const layout = computePianoRollLayout(midi, viewHeight);
  const { rowHeight, height, width, beats, ticksPerBeat, pitches } = layout;
  const totalWidth = width + PADDING * 2;
  const totalHeight = height + PADDING * 2;

  const blackKeyRows = pitches
    .filter((pitch) => isBlackKey(pitch))
    .map((pitch) => `<rect x="0" y="${pitchToY(pitch, layout)}" width="${width}" height="${rowHeight}" fill="#00000010"/>`)
    .join("");

  const gridLines = Array.from({ length: Math.ceil(beats) + 1 }, (_, i) => {
    const x = i * PIXELS_PER_BEAT;
    const strokeWidth = i % 4 === 0 ? 1 : 0.5;
    return `<line x1="${x}" x2="${x}" y1="0" y2="${height}" stroke="#00000022" stroke-width="${strokeWidth}"/>`;
  }).join("");

  const notes = midi.notes
    .map((note) => {
      const x = tickToX(note.startTick, ticksPerBeat);
      const noteWidth = Math.max(1.5, tickToX(note.endTick, ticksPerBeat) - x);
      const y = pitchToY(note.pitch, layout);
      return `<rect x="${x}" y="${y}" width="${noteWidth}" height="${Math.max(2, rowHeight - 1)}" rx="1" fill="${noteColor(note.pitch, note.velocity)}" opacity="0.9"/>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`,
    `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff"/>`,
    `<g transform="translate(${PADDING}, ${PADDING})">`,
    blackKeyRows,
    gridLines,
    notes,
    `</g>`,
    `</svg>`,
  ].join("");
}
