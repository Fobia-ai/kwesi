import { useEffect, useState } from "react";
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
 * The transport pill: prev / play / next, the seek bar, and the lyrics /
 * speed / volume cluster — one row, nothing nested inside it. Deliberately
 * carries no title or artwork: the hero above already states which track
 * this is, and repeating it here made the pill twice as tall as it needs
 * to be. One shared player underneath (playerStore), so this is a view of
 * it rather than a second audio element.
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
  const problem = fileState === "missing" ? "No audio file for this track." : isActive && status === "error" ? error : null;

  function start() {
    player.setQueue(queue);
    void player.play(track);
  }

  function cycleRate() {
    const index = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    player.setPlaybackRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]);
  }

  return (
    <div className="kwesi-glass-strong flex min-w-0 flex-1 items-center gap-2 rounded-chip px-2.5 py-2 shadow-glass-sm">
      <button type="button" onClick={() => player.previous()} disabled={!playable} className={ICON_BUTTON} aria-label="Previous">
        <SkipBackIcon width={17} height={17} />
      </button>
      <button
        type="button"
        onClick={() => (isActive ? player.togglePlayPause() : start())}
        disabled={!playable || isLoading}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-glass-sm transition-transform duration-150 active:scale-95 disabled:opacity-40"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon width={17} height={17} /> : <PlayIcon width={17} height={17} />}
      </button>
      <button type="button" onClick={() => player.next()} disabled={!playable} className={ICON_BUTTON} aria-label="Next">
        <SkipForwardIcon width={17} height={17} />
      </button>

      {problem ? (
        <p className="min-w-0 flex-1 truncate px-2 text-[11px] text-red-500">{problem}</p>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <span className="w-9 shrink-0 text-[11px] tabular-nums text-ink-muted">{formatDuration(shownTime)}</span>
          <input
            type="range"
            min={0}
            max={shownDuration || 0.01}
            step={0.01}
            value={Math.min(shownTime, shownDuration || 0)}
            onChange={(e) => {
              if (!isActive) start();
              player.seek(Number(e.target.value));
            }}
            disabled={!playable}
            aria-label="Seek"
            className="h-1 min-w-0 flex-1 accent-accent disabled:opacity-40"
          />
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
            {formatDuration(shownDuration)}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleLyrics}
        aria-pressed={lyricsActive}
        className={`${ICON_BUTTON} ${lyricsActive ? "!bg-accent !text-accent-ink" : ""}`}
        aria-label="Lyrics"
        title="Lyrics"
      >
        <LyricsIcon width={16} height={16} />
      </button>
      <button
        type="button"
        onClick={cycleRate}
        className="h-9 min-w-[2.5rem] shrink-0 rounded-full px-2 text-[11px] font-semibold tabular-nums text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink"
        aria-label="Playback speed"
        title="Playback speed"
      >
        {playbackRate}×
      </button>
      <label className="hidden shrink-0 items-center gap-1.5 pr-1 text-ink-muted xl:flex" title="Volume">
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
  );
}
