import { useEffect, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PianoRollIcon } from "../ui/icons";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";

interface AbcScoreViewerProps {
  filePath: string;
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

/**
 * Plain monospace text render of a real ABC-notation score (YuE2's own
 * symbolic output — see src/data/manifests.ts's YUE2 entry) rather than a
 * real staff-notation/piano-roll view: this app's PianoRollViewer only
 * parses binary Standard MIDI File bytes, ABC is a completely different
 * text format, and there's no ABC->MIDI converter anywhere in the YuE2
 * repo to bridge the two. Showing the real notation as text beats not
 * showing it at all; a real ABC renderer is separate, larger scope.
 */
export function AbcScoreViewer({ filePath }: AbcScoreViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("checking");
    setText(null);

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
      setText(new TextDecoder().decode(result.bytes));
      setLoadState("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loadState === "checking" || loadState === "loading") {
    return (
      <GlassPanel className="p-3">
        <p className="text-xs text-ink-muted">{loadState === "checking" ? "Checking score…" : "Loading score…"}</p>
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
          {loadState === "empty" ? "No score yet for this generation." : "Couldn't read this score."}
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="max-h-72 overflow-y-auto p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink/90">{text}</pre>
    </GlassPanel>
  );
}
