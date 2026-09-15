import { GlassPanel } from "../ui/GlassPanel";
import { WaveformIcon, PianoRollIcon } from "../ui/icons";

export type OutputKind = "audio" | "midi" | "audio+midi";
export type GenerationStatus = "queued" | "running" | "done" | "failed";

interface OutputViewerPlaceholderProps {
  outputKind: OutputKind;
  status: GenerationStatus;
  progressPct?: number;
  error?: string | null;
}

// Both the waveform player (Phase 6, src/components/audio/WaveformPlayer.tsx)
// and the piano-roll viewer (Phase 7, src/components/midi/PianoRollViewer.tsx)
// are real now — this slot is only reached as a fallback when a "done"
// generation has no real output file matching its declared output_kind yet
// (e.g. a still-mocked model, per kwesi.docs/04-roadmap.md's per-phase
// simplifications), not a "not built yet" placeholder anymore.
function ViewerSlot({ kind }: { kind: "audio" | "midi" }) {
  const Icon = kind === "audio" ? WaveformIcon : PianoRollIcon;
  const label = kind === "audio" ? "Waveform player" : "Piano-roll viewer";
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-ink/15 py-8 text-center">
      <div className="text-ink-muted">
        <Icon width={24} height={24} />
      </div>
      <p className="text-xs text-ink-muted">{label} will appear here once a real output file exists.</p>
    </div>
  );
}

export function OutputViewerPlaceholder({ outputKind, status, progressPct, error }: OutputViewerPlaceholderProps) {
  if (status === "queued" || status === "running") {
    return (
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">
            {status === "queued" ? "Queued…" : `Generating… ${progressPct ?? 0}%`}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300 ease-smooth"
              style={{ width: `${status === "queued" ? 4 : Math.max(4, progressPct ?? 0)}%` }}
            />
          </div>
        </div>
      </GlassPanel>
    );
  }

  if (status === "failed") {
    return (
      <GlassPanel className="p-4">
        <p className="text-xs text-red-600">{error ?? "Generation failed."}</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="flex flex-col gap-3 p-4">
      {(outputKind === "audio" || outputKind === "audio+midi") && <ViewerSlot kind="audio" />}
      {(outputKind === "midi" || outputKind === "audio+midi") && <ViewerSlot kind="midi" />}
    </GlassPanel>
  );
}
