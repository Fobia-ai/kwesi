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
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

const PIXELS_PER_BEAT = 24;
const DEFAULT_VIEW_HEIGHT = 220;
// Bounds on a single semitone's row height once it's scaled to the view.
const MIN_ROW_HEIGHT = 3;
const MAX_ROW_HEIGHT = 14;

function noteColor(track: number): string {
  const palette = ["rgb(var(--kwesi-accent))", "#8b8b8b", "#b0b0b0", "#6b6b6b"];
  return palette[track % palette.length];
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

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-[10px] bg-ink/[0.03]">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Piano roll">
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
            fill={noteColor(note.track)}
            opacity={0.55 + (note.velocity / 127) * 0.45}
          />
        ))}
      </svg>
    </div>
  );
}

export function PianoRollViewer({ filePath, compact, viewHeight = DEFAULT_VIEW_HEIGHT }: PianoRollViewerProps) {
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
    return (
      <GlassPanel className="p-3">
        <p className="text-xs text-ink-muted">{loadState === "checking" ? "Checking MIDI…" : "Loading piano roll…"}</p>
      </GlassPanel>
    );
  }

  if (loadState === "empty" || loadState === "error") {
    return (
      <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="text-ink-muted">
          <PianoRollIcon width={20} height={20} />
        </div>
        <p className="text-xs text-ink-muted">
          {loadState === "empty" ? "No MIDI yet for this generation." : "Couldn't parse this MIDI file."}
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={`flex flex-col gap-2 ${compact ? "p-2.5" : "p-4"}`}>
      {midi && <PianoRollSvg midi={midi} viewHeight={viewHeight} />}
      {midi && (
        <p className="text-[11px] text-ink-muted">
          {midi.notes.length} notes · {midi.trackCount} track{midi.trackCount === 1 ? "" : "s"}
        </p>
      )}

    </GlassPanel>
  );
}
