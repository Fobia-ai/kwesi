import { useEffect, useState, type ChangeEvent } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PillButton } from "../ui/PillButton";
import { WaveformIcon, PlayIcon, PauseIcon, DownloadIcon, ExportIcon, FolderIcon, VolumeIcon } from "../ui/icons";
import { usePlayer, type PlayerTrack } from "../../lib/playerStore";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat, suggestedExportName } from "../../lib/audioFiles";
import { formatDuration } from "../../lib/format";

interface WaveformPlayerProps {
  generationId: string;
  filePath: string;
  title: string;
  compact?: boolean;
}

type LoadState = "checking" | "ready" | "empty" | "error";

export function WaveformPlayer({ generationId, filePath, title, compact }: WaveformPlayerProps) {
  const player = usePlayer();
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("checking");
    kwesiAudio.stat(filePath).then((stat) => {
      if (cancelled) return;
      const classification = classifyAudioStat(stat);
      setLoadState(classification === "ready" ? "ready" : classification === "unknown" ? "error" : "empty");
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const track: PlayerTrack = { generationId, filePath, title };
  const isActive = player.isActive(generationId);
  const isPlaying = isActive && player.state.status === "playing";
  const isLoading = isActive && player.state.status === "loading";
  const currentTime = isActive ? player.state.currentTime : 0;
  const duration = isActive ? player.state.duration : 0;

  function handlePlayPause() {
    if (isActive) player.togglePlayPause();
    else player.play(track);
  }

  function handleSeek(e: ChangeEvent<HTMLInputElement>) {
    const time = Number(e.target.value);
    if (!isActive) player.play(track);
    player.seek(time);
  }

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

  if (loadState === "checking") {
    return (
      <GlassPanel className="p-3">
        <p className="text-xs text-ink-muted">Checking audio…</p>
      </GlassPanel>
    );
  }

  if (loadState === "empty" || loadState === "error") {
    return (
      <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="text-ink-muted">
          <WaveformIcon width={20} height={20} />
        </div>
        <p className="text-xs text-ink-muted">
          {loadState === "empty" ? "No audio yet for this generation." : "Couldn't load this audio file."}
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={`flex flex-col gap-2 ${compact ? "p-2.5" : "p-4"}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={handlePlayPause}
          disabled={isLoading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0.01}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          aria-label="Seek"
          className="h-1.5 flex-1 accent-accent"
        />
        <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>

      {!compact && (
        <>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-ink-muted">
              <VolumeIcon width={16} height={16} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.state.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1.5 w-20 accent-accent"
              />
            </label>
            <div className="flex items-center gap-1.5">
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
          </div>
          {saveStatus && <p className="text-[11px] text-ink-muted">{saveStatus}</p>}
        </>
      )}
    </GlassPanel>
  );
}
