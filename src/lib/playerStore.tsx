import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { kwesiAudio } from "./audio";

export interface PlayerTrack {
  generationId: string;
  filePath: string;
  title: string;
  subtitle?: string;
  avatarPath?: string | null;
  avatarName?: string;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PlayerState {
  track: PlayerTrack | null;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  // The ordered set of tracks next/previous step through (and `ended`
  // auto-advances along) — whatever list the track was started from.
  queue: PlayerTrack[];
  error: string | null;
}

type PlayerAction =
  | { type: "load_start"; track: PlayerTrack }
  | { type: "load_error"; error: string }
  | { type: "time"; currentTime: number; duration: number }
  | { type: "status"; status: PlayerStatus }
  | { type: "ended" }
  | { type: "volume"; volume: number }
  | { type: "rate"; playbackRate: number }
  | { type: "queue"; queue: PlayerTrack[] };

const initialState: PlayerState = {
  track: null,
  status: "idle",
  currentTime: 0,
  duration: 0,
  volume: 1,
  playbackRate: 1,
  queue: [],
  error: null,
};

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "load_start":
      return { ...state, track: action.track, status: "loading", currentTime: 0, duration: 0, error: null };
    case "load_error":
      return { ...state, status: "error", error: action.error };
    case "time":
      return { ...state, currentTime: action.currentTime, duration: action.duration };
    case "status":
      return { ...state, status: action.status, error: null };
    case "ended":
      return { ...state, status: "paused", currentTime: 0 };
    case "volume":
      return { ...state, volume: action.volume };
    case "rate":
      return { ...state, playbackRate: action.playbackRate };
    case "queue":
      return { ...state, queue: action.queue };
    default:
      return state;
  }
}

export interface PlayerContextValue {
  state: PlayerState;
  play: (track: PlayerTrack) => void;
  togglePlayPause: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  setQueue: (queue: PlayerTrack[]) => void;
  next: () => void;
  previous: () => void;
  isActive: (generationId: string) => boolean;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // `play` is defined below but the ended-listener above it needs to call
  // the latest one — a ref keeps that effect's deps empty.
  const playRef = useRef<(track: PlayerTrack) => Promise<void>>(async () => {});

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTime = () =>
      dispatch({
        type: "time",
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    const onPlay = () => dispatch({ type: "status", status: "playing" });
    const onPause = () => dispatch({ type: "status", status: "paused" });
    const onEnded = () => {
      dispatch({ type: "ended" });
      const { queue, track } = stateRef.current;
      const index = track ? queue.findIndex((t) => t.generationId === track.generationId) : -1;
      const following = index >= 0 ? queue[index + 1] : undefined;
      if (following) void playRef.current(following);
    };
    const onError = () => dispatch({ type: "load_error", error: "Playback error" });

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const play = useCallback(async (track: PlayerTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (stateRef.current.track?.generationId === track.generationId && stateRef.current.status !== "error") {
      try {
        await audio.play();
      } catch {
        dispatch({ type: "load_error", error: "Couldn't resume playback" });
      }
      return;
    }

    dispatch({ type: "load_start", track });
    const result = await kwesiAudio.read(track.filePath);
    if (!result.ok || !result.bytes) {
      dispatch({ type: "load_error", error: result.reason ?? "No audio available" });
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const blob = new Blob([result.bytes as BlobPart], { type: result.mimeType ?? "audio/wav" });
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    audio.src = url;
    audio.volume = stateRef.current.volume;
    audio.playbackRate = stateRef.current.playbackRate;
    try {
      await audio.play();
    } catch (err) {
      dispatch({ type: "load_error", error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  playRef.current = play;

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !stateRef.current.track) return;
    if (stateRef.current.status === "playing") {
      audio.pause();
    } else {
      audio.play().catch(() => dispatch({ type: "load_error", error: "Couldn't resume playback" }));
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    dispatch({ type: "time", currentTime: time, duration: stateRef.current.duration });
  }, []);

  const setVolume = useCallback((volume: number) => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
    dispatch({ type: "volume", volume });
  }, []);

  const setPlaybackRate = useCallback((playbackRate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = playbackRate;
    dispatch({ type: "rate", playbackRate });
  }, []);

  const setQueue = useCallback((queue: PlayerTrack[]) => {
    dispatch({ type: "queue", queue });
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const { queue, track } = stateRef.current;
      if (queue.length === 0) return;
      const index = track ? queue.findIndex((t) => t.generationId === track.generationId) : -1;
      const target = index === -1 ? queue[0] : queue[index + direction];
      if (target) void play(target);
    },
    [play],
  );
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => {
    // Standard player convention: "previous" first restarts the current
    // track if it's more than a couple of seconds in, and only steps back
    // once you're at the start.
    if (stateRef.current.currentTime > 3) {
      seek(0);
      return;
    }
    step(-1);
  }, [step, seek]);

  const isActive = useCallback(
    (generationId: string) => stateRef.current.track?.generationId === generationId,
    [],
  );

  const value = useMemo<PlayerContextValue>(
    () => ({ state, play, togglePlayPause, pause, seek, setVolume, setPlaybackRate, setQueue, next, previous, isActive }),
    [state, play, togglePlayPause, pause, seek, setVolume, setPlaybackRate, setQueue, next, previous, isActive],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} className="hidden" data-testid="kwesi-mini-player-audio" />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
