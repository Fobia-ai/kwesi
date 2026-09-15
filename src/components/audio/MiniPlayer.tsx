import { GlassPanel } from "../ui/GlassPanel";
import { PlayIcon, PauseIcon, WaveformIcon } from "../ui/icons";
import { usePlayer } from "../../lib/playerStore";
import { formatDuration } from "../../lib/format";

export function MiniPlayer() {
  const player = usePlayer();
  const { track, status, currentTime, duration, volume, error } = player.state;

  if (!track) return null;

  const isPlaying = status === "playing";

  return (
    <GlassPanel strong radius="panel" className="mx-8 mb-6 flex items-center gap-4 px-4 py-3">
      <div className="text-ink-muted">
        <WaveformIcon width={18} height={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{track.title}</p>
        {status === "error" ? (
          <p className="mt-1 text-[11px] text-red-500">{error ?? "Playback error"}</p>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={duration || 0.01}
              step={0.01}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => player.seek(Number(e.target.value))}
              aria-label="Seek"
              className="h-1 flex-1 accent-accent"
            />
            <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>
        )}
      </div>
      <button
        onClick={() => player.togglePlayPause()}
        disabled={status === "loading" || status === "error"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        aria-label="Volume"
        className="h-1 w-16 shrink-0 accent-accent"
      />
    </GlassPanel>
  );
}
