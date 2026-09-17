import { useEffect, useState } from "react";
import { kwesiAudio } from "./audio";
import { classifyAudioStat } from "./audioFiles";
import { parseMidi, type ParsedMidi } from "./midiParser";
import { midiToAbc } from "./midiToAbc";
import { abcToMidiBytes } from "./abcToMidi";

export interface NotationData {
  midi: ParsedMidi | null;
  abcText: string | null;
}

export type NotationLoadState = "checking" | "loading" | "ready" | "empty" | "error";

/**
 * Loads whichever real notation file a generation has (a .mid or a .abc,
 * never both) and derives the other representation from it, once, shared
 * across all four notation tabs (Midi, ABC, Midi.Txt, ABC.Txt) so switching
 * between them doesn't re-read or re-convert anything. A real .mid derives
 * ABC text via this app's own midiToAbc quantizer; a real .abc derives real
 * MIDI bytes via abcjs's synth.getMidiFile (see lib/abcToMidi.ts) which are
 * then parsed with this app's own MIDI parser like any other .mid file.
 */
export function useNotationData(
  midiFilePath: string | undefined,
  abcFilePath: string | undefined,
  title: string,
): { state: NotationLoadState; data: NotationData | null } {
  const [state, setState] = useState<NotationLoadState>("checking");
  const [data, setData] = useState<NotationData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("checking");
    setData(null);

    if (!midiFilePath && !abcFilePath) {
      setState("empty");
      return undefined;
    }

    (async () => {
      const sourcePath = midiFilePath ?? abcFilePath!;
      const stat = await kwesiAudio.stat(sourcePath);
      if (cancelled) return;
      const classification = classifyAudioStat(stat);
      if (classification === "unknown") {
        setState("error");
        return;
      }
      if (classification !== "ready") {
        setState("empty");
        return;
      }

      setState("loading");
      const result = await kwesiAudio.read(sourcePath);
      if (cancelled) return;
      if (!result.ok || !result.bytes) {
        setState("error");
        return;
      }

      let midi: ParsedMidi | null = null;
      let abcText: string | null = null;

      if (midiFilePath) {
        try {
          midi = parseMidi(result.bytes);
        } catch {
          midi = null;
        }
        if (midi) abcText = midiToAbc(midi, title);
      } else {
        abcText = new TextDecoder().decode(result.bytes);
        const derivedMidiBytes = abcToMidiBytes(abcText);
        if (derivedMidiBytes) {
          try {
            midi = parseMidi(derivedMidiBytes);
          } catch {
            midi = null;
          }
        }
      }

      if (cancelled) return;
      if (!midi && !abcText) {
        setState("error");
        return;
      }
      setData({ midi, abcText });
      setState("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [midiFilePath, abcFilePath, title]);

  return { state, data };
}
