import { useEffect, useState } from "react";
import { AvatarImage } from "../ui/AvatarImage";
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, LyricsIcon, VolumeIcon } from "../ui/icons";
import { usePlayer, PLAYBACK_RATES, type PlayerTrack } from "../../lib/playerStore";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";
import { formatDuration } from "../../lib/format";

interface TrackControlsProps {
  track: PlayerTrack;
  // The list this track was picked from, in play order — next/previous and
  // auto-advance step through it.
  queue: PlayerTrack[];
  lyricsActive: boolean;
  onToggleLyrics: () => void;
}

const ICON_BUTTON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * The hero's rounded transport pill: prev / play / next, the current track's
 * avatar + name, a seek bar, and the lyrics / speed / volume cluster. One
 * shared player underneath (playerStore), so this is a view of it, not a
 * second audio element — whichever screen you're on shows the same state.
 */
export function TrackControls({ track, queue, lyricsActive, onToggleLyrics }: TrackControlsProps) {
  const player = usePlayer();
  const [fileState, setFileState] = useState<"checking" | "ready" | "missing">("checking");

  useEffect(() => {
    let cancelled = false;
    setFileState("checking");
    kwesiAudio.stat(track.filePath).then((stat) => {
      if (cancelled) return;
      setFileState(classifyAudioStat(stat) === "ready" ? "ready" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [track.filePath]);

  const isActive = player.isActive(track.generationId);
  const { status, currentTime, duration, volume, playbackRate, error } = player.state;
  const isPlaying = isActive && status === "playing";
  const isLoading = isActive && status === "loading";
  const shownTime = isActive ? currentTime : 0;
  const shownDuration = isActive ? duration : 0;
  const playable = fileState === "ready";

  function start() {
    player.setQueue(queue);
    void player.play(track);
  }

  function handlePlayPause() {
    if (isActive) player.togglePlayPause();
    else start();
  }

  function handleSeek(time: number) {
    if (!isActive) start();
    player.seek(time);
  }

  function cycleRate() {
    const index = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    player.setPlaybackRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]);
  }

  return (
    <div className="kwesi-glass-strong flex items-center gap-3 rounded-chip py-2 pl-3 pr-4 shadow-glass-sm">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => player.previous()} disabled={!playable} className={ICON_BUTTON} aria-label="Previous">
          <SkipBackIcon width={18} height={18} />
        </button>
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!playable || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-glass-sm transition-transform duration-150 active:scale-95 disabled:opacity-40"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
        </button>
        <button type="button" onClick={() => player.next()} disabled={!playable} className={ICON_BUTTON} aria-label="Next">
          <SkipForwardIcon width={18} height={18} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-chip bg-ink/[0.05] py-1.5 pl-1.5 pr-4">
        <AvatarImage avatarPath={track.avatarPath ?? null} name={track.avatarName ?? track.title} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-4">{track.title}</p>
          {track.subtitle && <p className="truncate text-[11px] leading-4 text-ink-muted">{track.subtitle}</p>}
          {fileState === "missing" ? (
            <p className="text-[10px] text-red-500">No audio file for this track.</p>
          ) : isActive && status === "error" ? (
            <p className="text-[10px] text-red-500">{error ?? "Playback error"}</p>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] tabular-nums text-ink-muted">{formatDuration(shownTime)}</span>
              <input
                type="range"
                min={0}
                max={shownDuration || 0.01}
                step={0.01}
                value={Math.min(shownTime, shownDuration || 0)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                disabled={!playable}
                aria-label="Seek"
                className="h-1 min-w-0 flex-1 accent-accent disabled:opacity-40"
              />
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-muted">
                {formatDuration(shownDuration)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleLyrics}
          aria-pressed={lyricsActive}
          className={`${ICON_BUTTON} ${lyricsActive ? "!bg-accent !text-accent-ink" : ""}`}
          aria-label="Lyrics"
          title="Lyrics"
        >
          <LyricsIcon width={17} height={17} />
        </button>
        <button
          type="button"
          onClick={cycleRate}
          className="h-9 min-w-[2.6rem] rounded-full px-2 text-[11px] font-semibold tabular-nums text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink"
          aria-label="Playback speed"
          title="Playback speed"
        >
          {playbackRate}×
        </button>
        <label className="flex items-center gap-1.5 pl-1 text-ink-muted" title="Volume">
          <VolumeIcon width={16} height={16} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="h-1 w-16 accent-accent"
          />
        </label>
      </div>
    </div>
  );
}
