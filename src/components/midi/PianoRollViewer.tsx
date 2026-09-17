import { useEffect, useMemo, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PianoRollIcon } from "../ui/icons";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";
import { parseMidi, type ParsedMidi } from "../../lib/midiParser";
import {
  DEFAULT_VIEW_HEIGHT,
  PIXELS_PER_BEAT,
  computePianoRollLayout,
  isBlackKey,
  noteColor,
  pitchToY,
  tickToX,
} from "../../lib/pianoRollLayout";

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

function PianoRollSvg({ midi, viewHeight }: { midi: ParsedMidi; viewHeight: number }) {
  const layout = useMemo(() => computePianoRollLayout(midi, viewHeight), [midi, viewHeight]);
  const { rowHeight, height, width, beats, ticksPerBeat, pitches } = layout;
  const { notes } = midi;

  function x(tick: number): number {
    return tickToX(tick, ticksPerBeat);
  }
  function y(pitch: number): number {
    return pitchToY(pitch, layout);
  }

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

// Pure, in-memory presentation -- no file I/O -- reused by both
// PianoRollViewer (reads a real .mid file) and MidiFromAbcViewer (derives
// midi bytes from ABC text via abcjs and parses those instead).
export function PianoRollDisplay({ midi, viewHeight }: { midi: ParsedMidi; viewHeight: number }) {
  return (
    <>
      <PianoRollSvg midi={midi} viewHeight={viewHeight} />
      <p className="text-[11px] text-ink-muted">
        {midi.notes.length} notes · {midi.trackCount} track{midi.trackCount === 1 ? "" : "s"}
      </p>
    </>
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

  const content = midi && <PianoRollDisplay midi={midi} viewHeight={viewHeight} />;

  if (bare) return <div className="flex flex-col gap-2">{content}</div>;
  return <GlassPanel className={`flex flex-col gap-2 ${compact ? "p-2.5" : "p-4"}`}>{content}</GlassPanel>;
}
