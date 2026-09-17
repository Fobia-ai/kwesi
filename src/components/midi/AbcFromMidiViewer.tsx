import { useEffect, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PianoRollIcon } from "../ui/icons";
import { AbcNotationRenderer } from "./AbcNotationRenderer";
import { kwesiAudio } from "../../lib/audio";
import { classifyAudioStat } from "../../lib/audioFiles";
import { parseMidi } from "../../lib/midiParser";
import { midiToAbc } from "../../lib/midiToAbc";

interface AbcFromMidiViewerProps {
  filePath: string;
  title?: string;
  bare?: boolean;
}

type LoadState = "checking" | "loading" | "ready" | "empty" | "error";

/**
 * Same real ABC-notation rendering as AbcScoreViewer, but for outputs that
 * only have a MIDI file (MuseCoco, Museformer) and no native score.abc --
 * converts the parsed MIDI notes into ABC text (see lib/midiToAbc.ts) first.
 */
export function AbcFromMidiViewer({ filePath, title, bare }: AbcFromMidiViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [abc, setAbc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("checking");
    setAbc(null);

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
        const midi = parseMidi(result.bytes);
        if (midi.notes.length === 0) {
          setLoadState("empty");
          return;
        }
        setAbc(midiToAbc(midi, title));
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, title]);

  if (loadState === "checking" || loadState === "loading") {
    const message = <p className="text-xs text-ink-muted">{loadState === "checking" ? "Checking notation…" : "Converting to ABC…"}</p>;
    return bare ? message : <GlassPanel className="p-3">{message}</GlassPanel>;
  }

  if (loadState === "empty" || loadState === "error") {
    const message = (
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <div className="text-ink-muted">
          <PianoRollIcon width={20} height={20} />
        </div>
        <p className="text-xs text-ink-muted">
          {loadState === "empty" ? "No notation yet for this generation." : "Couldn't convert this MIDI to ABC."}
        </p>
      </div>
    );
    return bare ? message : <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 text-center">{message}</GlassPanel>;
  }

  const content = <AbcNotationRenderer abc={abc ?? ""} />;
  if (bare) return content;
  return <GlassPanel className="max-h-72 overflow-y-auto p-3">{content}</GlassPanel>;
}
