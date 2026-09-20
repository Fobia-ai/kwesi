import { useEffect, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PianoRollIcon } from "../ui/icons";
import { AbcNotationRenderer } from "./AbcNotationRenderer";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";

interface AbcScoreViewerProps {
  filePath: string;
  bare?: boolean;
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

/**
 * Real staff-notation render (via AbcNotationRenderer/abcjs) of a real
 * ABC-notation score file -- YuE2's own symbolic output, see
 * src/data/manifests.ts's YUE2 entry.
 */
export function AbcScoreViewer({ filePath, bare }: AbcScoreViewerProps) {
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
    const message = <p className="text-xs text-ink-muted">{loadState === "checking" ? "Checking score…" : "Loading score…"}</p>;
    return bare ? message : <GlassPanel className="p-3">{message}</GlassPanel>;
  }

  if (loadState === "empty" || loadState === "error") {
    const message = (
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <div className="text-ink-muted">
          <PianoRollIcon width={20} height={20} />
        </div>
        <p className="text-xs text-ink-muted">
          {loadState === "empty" ? "No score yet for this generation." : "Couldn't read this score."}
        </p>
      </div>
    );
    return bare ? message : <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 text-center">{message}</GlassPanel>;
  }

  const content = <AbcNotationRenderer abc={text ?? ""} />;
  if (bare) return content;
  return <GlassPanel className="max-h-72 overflow-auto p-3">{content}</GlassPanel>;
}
