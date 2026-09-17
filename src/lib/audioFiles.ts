const AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".ogg", ".aiff"];
const MIDI_EXTENSIONS = [".mid", ".midi"];
// YuE2's real symbolic output is ABC notation text, not a binary Standard
// MIDI File (see src/data/manifests.ts's YUE2 entry) -- a separate
// extension/finder rather than folding it into findMidiFile, since it's a
// different format needing its own (text, not piano-roll) viewer.
const ABC_EXTENSIONS = [".abc"];

export function findAudioFile(files: string[]): string | undefined {
  return files.find((file) => AUDIO_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)));
}

export function findMidiFile(files: string[]): string | undefined {
  return files.find((file) => MIDI_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)));
}

export function findAbcFile(files: string[]): string | undefined {
  return files.find((file) => ABC_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)));
}

export function parseOutputFiles(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export type AudioAssetState = "unknown" | "missing" | "empty" | "ready";

export function classifyAudioStat(
  stat: { exists: boolean; sizeBytes: number } | null | undefined,
): AudioAssetState {
  if (!stat) return "unknown";
  if (!stat.exists) return "missing";
  if (stat.sizeBytes <= 0) return "empty";
  return "ready";
}

export function suggestedExportName(filePath: string, title: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const ext = lastDot >= 0 ? filePath.slice(lastDot) : ".wav";
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${safeTitle || "kwesi-generation"}${ext}`;
}
