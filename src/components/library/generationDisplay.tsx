import type { ReactNode } from "react";
import type { GenerationRow } from "../../lib/db";
import { getManifest, type ManifestSelectOption, type ModelManifest } from "../../data/manifests";
import { LICENSE_LABEL } from "../../data/catalog";

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "live" | "bad" }) {
  const toneClass =
    tone === "bad"
      ? "bg-red-500/12 text-red-600 dark:text-red-400"
      : tone === "live"
        ? "bg-accent/12 text-ink"
        : "bg-ink/[0.07] text-ink-muted";
  return (
    <span className={`shrink-0 rounded-chip px-2 py-0.5 text-[10px] font-medium tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  if (status === "done") return <Chip>Done</Chip>;
  if (status === "failed") return <Chip tone="bad">Failed</Chip>;
  if (status === "cancelled") return <Chip>Cancelled</Chip>;
  return (
    <Chip tone="live">
      <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
      {status === "running" ? "Generating" : "Queued"}
    </Chip>
  );
}

// Non-commercial-licensed outputs get a visible badge wherever they can be
// saved out. MIT models render nothing — nothing to warn about. RAVE's
// cc-by-nc-sa is the strictest tier in the catalog (share-alike on top of
// non-commercial), so its tooltip spells that out.
export function LicenseBadge({ modelId }: { modelId: string }) {
  const manifest = getManifest(modelId);
  if (!manifest || manifest.licenseTier === "mit") return null;
  const terms =
    manifest.licenseTier === "cc-by-nc-sa"
      ? "non-commercial use only, and any derivative work must be shared under this same license (share-alike)."
      : "non-commercial use only.";
  return (
    <span
      className="shrink-0 rounded-chip bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
      title={`${manifest.displayName} output is licensed ${LICENSE_LABEL[manifest.licenseTier]} — ${terms}`}
    >
      {LICENSE_LABEL[manifest.licenseTier]}
    </span>
  );
}

export function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function parseParams(generation: GenerationRow): Record<string, unknown> {
  try {
    return JSON.parse(generation.input_params) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Keys rendered in their own dedicated blocks rather than the params grid. */
export const PROMPT_KEYS = ["prompt", "text_prompt"];
export const LYRICS_KEYS = ["lyrics"];

/**
 * Every generation carries a required `music_name` (DynamicGenerationForm
 * always renders it as "Track name", independent of any model's manifest
 * inputs) — that's the real title. The prompt/lyrics/first-string fallbacks
 * only cover generations created before this field existed.
 */
export function generationTitle(generation: GenerationRow): string {
  const params = parseParams(generation);
  const musicName = params.music_name;
  if (typeof musicName === "string" && musicName.trim()) return musicName.trim();
  for (const key of [...PROMPT_KEYS, ...LYRICS_KEYS]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(params)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return generation.checkpoint_variant ?? "Track";
}

export function generationPrompt(generation: GenerationRow): string | undefined {
  const params = parseParams(generation);
  return PROMPT_KEYS.map((key) => params[key]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function generationLyrics(generation: GenerationRow): string | undefined {
  const params = parseParams(generation);
  return LYRICS_KEYS.map((key) => params[key]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function generationGenres(generation: GenerationRow): string[] {
  const value = parseParams(generation).artist_genres;
  return Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];
}

export function generationArtistId(generation: GenerationRow): string | null {
  const value = parseParams(generation).artist_profile_id;
  return typeof value === "string" && value ? value : null;
}

// `select`/`multiselect` inputs store a raw option value (e.g. MuseCoco
// genre's server token "rap"), not the friendly label ("Hip-Hop") shown in
// the form — map back through the manifest's own options so the details
// grid reads the same as the form did, falling back to the raw value for
// anything that doesn't match (e.g. a value from before an option list
// changed).
export function formatParamValue(value: unknown, options?: ManifestSelectOption[]): string | null {
  if (value === null || value === undefined || value === "") return null;
  const labelFor = (raw: unknown): string => options?.find((o) => o.value === raw)?.label ?? String(raw);
  if (Array.isArray(value)) return value.length ? value.map(labelFor).join(", ") : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return options ? labelFor(value) : String(value);
}

export function ParamsGrid({ generation, manifest }: { generation: GenerationRow; manifest: ModelManifest | undefined }) {
  const params = parseParams(generation);
  const rows = Object.entries(params)
    .filter(
      ([key]) =>
        key !== "music_name" &&
        key !== "artist_profile_id" &&
        key !== "artist_genres" &&
        !PROMPT_KEYS.includes(key) &&
        !LYRICS_KEYS.includes(key),
    )
    .map(([key, value]) => {
      const input = manifest?.inputs.find((i) => i.key === key);
      const options = input?.type === "select" || input?.type === "multiselect" ? input.options : undefined;
      return { key, label: input?.label ?? key, value: formatParamValue(value, options) };
    })
    .filter((row) => row.value !== null);

  if (rows.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Parameters</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <div key={row.key} className="min-w-0 rounded-[10px] bg-ink/[0.04] px-3 py-2">
            <dt className="truncate text-[10px] uppercase tracking-wide text-ink-muted">{row.label}</dt>
            <dd className="truncate text-xs text-ink" title={row.value ?? undefined}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
