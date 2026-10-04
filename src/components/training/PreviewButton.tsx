import { useEffect, useRef, useState } from "react";
import { PillButton } from "../ui/PillButton";
import { PauseIcon, PlayIcon } from "../ui/icons";
import { kwesiTraining } from "../../lib/training";

/**
 * Plays the short clip a trained model made when its run finished. The
 * bytes come over IPC (the renderer can only read the workspaces folder)
 * and are loaded on first play, not up front.
 */
export function PreviewButton({ trainedModelId, label = "Preview" }: { trainedModelId: string; label?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function toggle() {
    if (playing) {
      audioRef.current?.pause();
      return;
    }
    if (!audioRef.current) {
      const bytes = await kwesiTraining.readTrainedPreview(trainedModelId);
      if (!bytes) {
        setMissing(true);
        return;
      }
      urlRef.current = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
      const audio = new Audio(urlRef.current);
      audio.onplay = () => setPlaying(true);
      audio.onpause = () => setPlaying(false);
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
    }
    await audioRef.current.play();
  }

  if (missing) return null;
  return (
    <PillButton variant="ghost" size="sm" onClick={toggle} aria-label={playing ? "Pause preview" : "Play preview"}>
      {playing ? <PauseIcon width={13} height={13} /> : <PlayIcon width={13} height={13} />}
      {label}
    </PillButton>
  );
}
