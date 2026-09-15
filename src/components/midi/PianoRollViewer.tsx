import { useEffect, useMemo, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PillButton } from "../ui/PillButton";
import { PianoRollIcon, DownloadIcon, ExportIcon, FolderIcon } from "../ui/icons";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat, suggestedExportName } from "../../lib/audioFiles";
import { parseMidi, type ParsedMidi } from "../../lib/midiParser";

interface PianoRollViewerProps {
  filePath: string;
  title: string;
  compact?: boolean;
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

const NOTE_HEIGHT = 3;
const PIXELS_PER_BEAT = 24;
const VIEW_HEIGHT = 220;

function noteColor(track: number): string {
  const palette = ["rgb(var(--kwesi-accent))", "#8b8b8b", "#b0b0b0", "#6b6b6b"];
  return palette[track % palette.length];
}

function PianoRollSvg({ midi }: { midi: ParsedMidi }) {
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

  const pitchSpan = Math.max(1, maxPitch - minPitch);
  const height = Math.max(VIEW_HEIGHT, pitchSpan * NOTE_HEIGHT);
  const beats = Math.max(1, durationTicks / (ticksPerBeat || 480));
  const width = Math.max(320, beats * PIXELS_PER_BEAT);

  function x(tick: number): number {
    return (tick / (ticksPerBeat || 480)) * PIXELS_PER_BEAT;
  }
  function y(pitch: number): number {
    return height - (pitch - minPitch) * NOTE_HEIGHT;
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
            height={NOTE_HEIGHT - 0.5}
            rx={1}
            fill={noteColor(note.track)}
            opacity={0.55 + (note.velocity / 127) * 0.45}
          />
        ))}
      </svg>
    </div>
  );
}

export function PianoRollViewer({ filePath, title, compact }: PianoRollViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [midi, setMidi] = useState<ParsedMidi | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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

  async function handleSave(kind: "export" | "download") {
    setSaveStatus(kind === "export" ? "Exporting…" : "Downloading…");
    const name = suggestedExportName(filePath, title);
    const result = await kwesiAudio.save(filePath, name, kind);
    if (result.ok) setSaveStatus(`Saved to ${result.path}`);
    else if (result.reason === "cancelled") setSaveStatus(null);
    else setSaveStatus(result.reason ?? "Save failed");
  }

  async function handleReveal() {
    const result = await kwesiAudio.reveal(filePath);
    setSaveStatus(result.ok ? null : "Couldn't reveal the file.");
  }

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
      {midi && <PianoRollSvg midi={midi} />}
      {midi && (
        <p className="text-[11px] text-ink-muted">
          {midi.notes.length} notes · {midi.trackCount} track{midi.trackCount === 1 ? "" : "s"}
        </p>
      )}

      {!compact && (
        <>
          <div className="flex items-center justify-end gap-1.5">
            <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={() => handleSave("export")}>
              <ExportIcon width={14} height={14} /> Export
            </PillButton>
            <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={() => handleSave("download")}>
              <DownloadIcon width={14} height={14} /> Download
            </PillButton>
            <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={handleReveal}>
              <FolderIcon width={14} height={14} /> Share
            </PillButton>
          </div>
          {saveStatus && <p className="text-[11px] text-ink-muted">{saveStatus}</p>}
        </>
      )}
    </GlassPanel>
  );
}
