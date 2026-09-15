const AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".ogg", ".aiff"];

export function findAudioFile(files: string[]): string | undefined {
  return files.find((file) => AUDIO_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)));
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
