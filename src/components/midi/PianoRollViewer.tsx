import { useEffect, useMemo, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PianoRollIcon } from "../ui/icons";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";
import { parseMidi, type ParsedMidi } from "../../lib/midiParser";

interface PianoRollViewerProps {
  filePath: string;
  compact?: boolean;
  // How tall to draw the roll. Defaults to a comfortable standalone size;
  // the hero passes a shorter one to sit inside its transport row.
  viewHeight?: number;
  // Skips the outer GlassPanel (its own background/border/padding/shadow)
  // for callers that already provide their own chrome — BottomSheet,
  // RowDetails — so the roll doesn't end up nested inside a box inside a
  // box inside a box.
  bare?: boolean;
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

const PIXELS_PER_BEAT = 24;
const DEFAULT_VIEW_HEIGHT = 220;
// Bounds on a single semitone's row height once it's scaled to the view.
const MIN_ROW_HEIGHT = 3;
const MAX_ROW_HEIGHT = 14;

// True for the 5 semitones that are a piano's black keys (C#, D#, F#, G#, A#)
// — used only to shade their rows faintly, the same visual cue a real piano
// roll editor gives so pitches read at a glance instead of needing the grid
// lines alone to judge octave position.
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function isBlackKey(pitch: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

// Colored by pitch class rather than by track — the same real, physical
// note-color convention chromatic Boomwhacker sets and music-education
// color charts use (C=red through B=violet), not an evenly-spaced
// mathematical hue wheel: real charts bunch warmer hues across the natural
// notes and compress the accidentals, so named colors (a real orange, a
// real green, a real blue) land where you'd expect them from an actual
// physical set, rather than an arbitrary 30°-per-semitone gradient.
// Index = pitch class (0=C ... 11=B).
const PITCH_CLASS_HUES = [0, 18, 32, 45, 55, 85, 140, 172, 197, 217, 255, 285];

function noteColor(pitch: number, velocity: number): string {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const hue = PITCH_CLASS_HUES[pitchClass];
  const loudness = velocity / 127;
  const saturation = 62 + loudness * 25;
  const lightness = 48 + loudness * 14;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function PianoRollSvg({ midi, viewHeight }: { midi: ParsedMidi; viewHeight: number }) {
  const { notes, ticksPerBeat, durationTicks } = midi;

  const { minPitch, maxPitch } = useMemo(() => {
    if (notes.length === 0) return { minPitch: 48, maxPitch: 72 };
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      if (n.pitch < lo) lo = n.pitch;
      if (n.pitch > hi) hi = n.pitch;
    }
    return { minPitch: Math.max(0, lo - 2), maxPitch: Math.min(127, hi + 2) };
  }, [notes]);

  // Rows scale to fill the view instead of being a fixed few pixels each:
  // notes are laid out from the bottom, so a fixed row height left most of
  // the canvas as dead space above them for any ordinary pitch range (a
  // ~20-semitone span drew 60px of notes inside a 220px box).
  const pitchCount = Math.max(1, maxPitch - minPitch + 1);
  const rowHeight = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, viewHeight / pitchCount));
  const height = Math.round(pitchCount * rowHeight);
  const beats = Math.max(1, durationTicks / (ticksPerBeat || 480));
  const width = Math.max(320, beats * PIXELS_PER_BEAT);

  function x(tick: number): number {
    return (tick / (ticksPerBeat || 480)) * PIXELS_PER_BEAT;
  }
  function y(pitch: number): number {
    return height - (pitch - minPitch + 1) * rowHeight;
  }

  const pitches = useMemo(() => Array.from({ length: pitchCount }, (_, i) => minPitch + i), [minPitch, pitchCount]);

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-[10px] bg-ink/[0.03]">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Piano roll">
        {pitches
          .filter((pitch) => isBlackKey(pitch))
          .map((pitch) => (
            <rect
              key={pitch}
              x={0}
              y={y(pitch)}
              width={width}
              height={rowHeight}
              className="fill-ink/[0.035]"
            />
          ))}
        {Array.from({ length: Math.ceil(beats) + 1 }, (_, i) => (
          <line
            key={i}
            x1={i * PIXELS_PER_BEAT}
            x2={i * PIXELS_PER_BEAT}
            y1={0}
            y2={height}
            stroke="currentColor"
            className="text-ink/[0.06]"
            strokeWidth={i % 4 === 0 ? 1 : 0.5}
          />
        ))}
        {notes.map((note, i) => (
          <rect
            key={i}
            x={x(note.startTick)}
            y={y(note.pitch)}
            width={Math.max(1.5, x(note.endTick) - x(note.startTick))}
            height={Math.max(2, rowHeight - 1)}
            rx={1}
            fill={noteColor(note.pitch, note.velocity)}
            opacity={0.88}
          />
        ))}
      </svg>
    </div>
  );
}

export function PianoRollViewer({
  filePath,
  compact,
  bare,
  viewHeight = DEFAULT_VIEW_HEIGHT,
}: PianoRollViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [midi, setMidi] = useState<ParsedMidi | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("checking");
    setMidi(null);

    kwesiAudio.stat(filePath).then(async (stat) => {
      if (cancelled) return;
      const classification = classifyAudioStat(stat);
      if (classification === "unknown") {
        setLoadState("error");
        return;
      }
      if (classification !== "ready") {
        setLoadState("empty");
        return;
      }
      setLoadState("loading");
      const result = await kwesiAudio.read(filePath);
      if (cancelled) return;
      if (!result.ok || !result.bytes) {
        setLoadState("error");
        return;
      }
      try {
        setMidi(parseMidi(result.bytes));
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loadState === "checking" || loadState === "loading") {
    const message = <p className="text-xs text-ink-muted">{loadState === "checking" ? "Checking MIDI…" : "Loading piano roll…"}</p>;
    return bare ? message : <GlassPanel className="p-3">{message}</GlassPanel>;
  }

  if (loadState === "empty" || loadState === "error") {
    const message = (
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <div className="text-ink-muted">
          <PianoRollIcon width={20} height={20} />
        </div>
        <p className="text-xs text-ink-muted">
          {loadState === "empty" ? "No MIDI yet for this generation." : "Couldn't parse this MIDI file."}
        </p>
      </div>
    );
    return bare ? message : <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 text-center">{message}</GlassPanel>;
  }

  const content = (
    <>
      {midi && <PianoRollSvg midi={midi} viewHeight={viewHeight} />}
      {midi && (
        <p className="text-[11px] text-ink-muted">
          {midi.notes.length} notes · {midi.trackCount} track{midi.trackCount === 1 ? "" : "s"}
        </p>
      )}
    </>
  );

  if (bare) return <div className="flex flex-col gap-2">{content}</div>;
  return <GlassPanel className={`flex flex-col gap-2 ${compact ? "p-2.5" : "p-4"}`}>{content}</GlassPanel>;
}
