import type { GenerationRow } from "./db";
import { kwesiAudio } from "./audio";
import { findAudioFile, findMidiFile, findAbcFile, parseOutputFiles } from "./audioFiles";
import { parseMidi, type ParsedMidi } from "./midiParser";
import { midiToAbc } from "./midiToAbc";
import { abcToMidiBytes } from "./abcToMidi";
import { midiToText } from "./midiTextDump";
import { renderPianoRollPng, renderAbcPng } from "./renderNotationImages";
import { buildZip, type ZipEntry } from "./zip";

export function sanitizeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "-").trim() || "kwesi-generation";
}

export type ExportPlan =
  | { kind: "single"; filePath: string; suggestedName: string }
  | { kind: "zip"; bytes: Uint8Array; suggestedName: string }
  | { kind: "none" };

interface BuildExportPlanArgs {
  generation: GenerationRow;
  title: string;
  // Passed in rather than re-derived here: generationLyrics (in
  // components/library/generationDisplay.tsx) checks several possible
  // manifest input keys, and lib/ modules don't reach into components/ --
  // the caller already has it on hand for the hero/row UI anyway.
  lyrics: string | undefined;
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot) : "";
}

async function readBytes(filePath: string): Promise<Uint8Array | null> {
  const result = await kwesiAudio.read(filePath);
  return result.ok && result.bytes ? result.bytes : null;
}

function parseInputParams(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildMetadataJson(generation: GenerationRow, inputParams: Record<string, unknown> | null): string {
  const metadata = {
    checkpoint_variant: generation.checkpoint_variant,
    status: generation.status,
    created_at: new Date(generation.created_at).toISOString(),
    duration_ms: generation.duration_ms,
    input_params: inputParams ?? {},
  };
  return JSON.stringify(metadata, null, 2);
}

/**
 * Decides what "Save a copy" actually saves: a plain single-file copy when
 * that's genuinely all there is, or a real ZIP package (audio/midi/abc
 * source files, rendered notation images, a genuinely derived counterpart
 * file when abcjs can produce one, raw text sidecars, lyrics, and
 * metadata.json) whenever there's more than one piece worth keeping.
 * Notation images/derived files are best-effort ("if possible" per the
 * original ask) -- a failed render or conversion just omits that one entry
 * rather than failing the whole export.
 */
export async function buildExportPlan({ generation, title, lyrics }: BuildExportPlanArgs): Promise<ExportPlan> {
  const files = parseOutputFiles(generation.output_files);
  const audioFile = findAudioFile(files);
  const midiFile = findMidiFile(files);
  const abcFile = findAbcFile(files);
  const inputParams = parseInputParams(generation.input_params);
  const hasSubstantiveParams = Boolean(inputParams && Object.keys(inputParams).length > 0);

  const realFileCount = [audioFile, midiFile, abcFile].filter(Boolean).length;
  const hasExtras = Boolean(lyrics) || hasSubstantiveParams || Boolean(midiFile) || Boolean(abcFile);

  if (realFileCount === 0) return { kind: "none" };

  // Nothing beyond the one real file is worth adding -- keep the simple,
  // familiar single-file save instead of zipping a lone audio file with an
  // empty metadata.json. Only applies to a bare audio-only track: a midi/abc
  // output always gets packaged, since the converted counterpart + images
  // *are* the value this feature adds, independent of lyrics or params.
  if (realFileCount === 1 && audioFile && !hasExtras) {
    return { kind: "single", filePath: audioFile, suggestedName: `${sanitizeFilename(title)}${extOf(audioFile)}` };
  }

  const entries: ZipEntry[] = [];

  if (audioFile) {
    const bytes = await readBytes(audioFile);
    if (bytes) entries.push({ name: `audio${extOf(audioFile)}`, data: bytes });
  }

  // Native midi + a converted ABC counterpart, or native abc + a genuinely
  // derived real midi counterpart (via abcjs) -- whichever direction the
  // real source file came from, both representations end up in the package.
  let realMidi: ParsedMidi | null = null;
  let derivedMidiBytes: Uint8Array | null = null;
  let abcText: string | null = null;

  if (midiFile) {
    const bytes = await readBytes(midiFile);
    if (bytes) {
      entries.push({ name: `notation${extOf(midiFile)}`, data: bytes });
      try {
        realMidi = parseMidi(bytes);
      } catch {
        realMidi = null;
      }
      if (realMidi) abcText = midiToAbc(realMidi, title);
    }
  } else if (abcFile) {
    const bytes = await readBytes(abcFile);
    if (bytes) {
      entries.push({ name: `notation${extOf(abcFile)}`, data: bytes });
      abcText = new TextDecoder().decode(bytes);
      derivedMidiBytes = abcToMidiBytes(abcText);
      if (derivedMidiBytes) {
        entries.push({ name: "notation.mid", data: derivedMidiBytes });
        try {
          realMidi = parseMidi(derivedMidiBytes);
        } catch {
          realMidi = null;
        }
      }
    }
  }

  if (abcText) {
    entries.push({ name: "notation.abc", data: new TextEncoder().encode(abcText) });
    const abcPng = await renderAbcPng(abcText);
    if (abcPng) entries.push({ name: "notation-abc.png", data: abcPng });
  }
  if (realMidi) {
    entries.push({ name: "notation.txt", data: new TextEncoder().encode(midiToText(realMidi, title)) });
    const pianoRollPng = await renderPianoRollPng(realMidi);
    if (pianoRollPng) entries.push({ name: "piano-roll.png", data: pianoRollPng });
  }

  if (lyrics) entries.push({ name: "lyrics.txt", data: new TextEncoder().encode(lyrics) });
  if (hasSubstantiveParams || entries.length > 0) {
    entries.push({ name: "metadata.json", data: new TextEncoder().encode(buildMetadataJson(generation, inputParams)) });
  }

  if (entries.length <= 1) {
    const only = audioFile ?? midiFile ?? abcFile!;
    return { kind: "single", filePath: only, suggestedName: `${sanitizeFilename(title)}${extOf(only)}` };
  }

  return { kind: "zip", bytes: buildZip(entries), suggestedName: `${sanitizeFilename(title)}.zip` };
}
