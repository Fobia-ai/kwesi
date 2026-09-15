import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { GlassPanel } from "../components/ui/GlassPanel";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { WorkspacesIcon, WaveformIcon } from "../components/ui/icons";
import {
  kwesiDb,
  type WorkspaceRow,
  type ProjectRow,
  type GenerationRow,
  type ModelVariantRow,
} from "../lib/db";
import { kwesiGeneration, type GenerationProgressEvent } from "../lib/generation";
import { kwesiHardware, type GpuVramInfo } from "../lib/hardware";
import { kwesiArtistProfiles, type ArtistProfile } from "../lib/artistProfiles";
import { AvatarImage } from "../components/ui/AvatarImage";
import { getManifest, outputKindOf, type ModelManifest, type ManifestSelectOption } from "../data/manifests";
import { LICENSE_LABEL } from "../data/catalog";
import { DynamicGenerationForm } from "../components/generation/DynamicGenerationForm";
import { OutputViewerPlaceholder, type GenerationStatus } from "../components/generation/OutputViewerPlaceholder";
import { WaveformPlayer } from "../components/audio/WaveformPlayer";
import { PianoRollViewer } from "../components/midi/PianoRollViewer";
import { findAudioFile, findMidiFile, parseOutputFiles } from "../lib/audioFiles";

// --- small shared bits -------------------------------------------------------

function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "live" | "bad" }) {
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

function StatusChip({ status }: { status: string }) {
  if (status === "done") return <Chip>Done</Chip>;
  if (status === "failed") return <Chip tone="bad">Failed</Chip>;
  return (
    <Chip tone="live">
      <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
      {status === "running" ? "Generating" : "Queued"}
    </Chip>
  );
}

// Phase 8: non-commercial-licensed outputs get a visible badge wherever they
// can be exported or shared. MIT models render no badge — nothing to warn
// about. RAVE's cc-by-nc-sa is the strictest tier in the catalog —
// share-alike on top of non-commercial — so its tooltip spells that out
// rather than reusing the generic wording every other non-mit model gets.
function LicenseBadge({ modelId }: { modelId: string }) {
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

function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parseParams(generation: GenerationRow): Record<string, unknown> {
  try {
    return JSON.parse(generation.input_params) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Keys rendered in their own dedicated blocks rather than the params grid. */
const PROMPT_KEYS = ["prompt", "text_prompt"];
const LYRICS_KEYS = ["lyrics"];

/**
 * Every generation now carries a required `music_name` (DynamicGenerationForm
 * always renders it, independent of any model's manifest inputs) — that's
 * the real title. The prompt/lyrics/first-string fallbacks below only cover
 * generations created before this field existed.
 */
function generationTitle(generation: GenerationRow): string {
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
  return generation.checkpoint_variant ?? "Generation";
}

// `select`/`multiselect` inputs store a raw option value (e.g. MuseCoco
// genre's server token "rap"), not the friendly label ("Hip-Hop") shown in
// the form — map back through the manifest's own options here so the
// Parameters grid reads the same as the form did, falling back to the raw
// value for anything that doesn't match (e.g. a value from before a
// manifest's option list changed).
function formatParamValue(value: unknown, options?: ManifestSelectOption[]): string | null {
  if (value === null || value === undefined || value === "") return null;
  const labelFor = (raw: unknown): string => options?.find((o) => o.value === raw)?.label ?? String(raw);
  if (Array.isArray(value)) return value.length ? value.map(labelFor).join(", ") : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return options ? labelFor(value) : String(value);
}

// --- modals / panels ---------------------------------------------------------

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal title="New Project" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="e.g. Verse ideas"
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
            Create
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Renders in the same pane slot as GenerationDetail rather than as an
 * overlay — the right-hand pane now does double duty as both the player
 * (an existing generation, selected) and the creation form (a new one, in
 * progress), never both at once. Its header mirrors GenerationDetail's own
 * (title + subtitle on the left, one action button on the right) so
 * switching between the two doesn't visually jolt.
 */
function NewGenerationPane({
  modelId,
  installedVariantNames,
  extraVariantNames,
  artistProfiles,
  onCancel,
  onSubmit,
  onTrackNameChange,
}: {
  modelId: string;
  installedVariantNames: string[];
  extraVariantNames: string[];
  artistProfiles: ArtistProfile[];
  onCancel: () => void;
  onSubmit: (checkpointVariant: string | null, values: Record<string, unknown>) => void;
  onTrackNameChange: (trackName: string) => void;
}) {
  const manifest = getManifest(modelId);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink/10 px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">New track</h2>
          {manifest?.displayName && <p className="truncate text-xs text-ink-muted">{manifest.displayName}</p>}
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 rounded-[8px] px-2 py-1 text-xs text-ink-muted transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600"
        >
          Cancel
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-5">
        {manifest ? (
          <DynamicGenerationForm
            manifest={manifest}
            installedVariantNames={installedVariantNames}
            extraVariantNames={extraVariantNames}
            artistProfiles={artistProfiles}
            onSubmit={onSubmit}
            onTrackNameChange={onTrackNameChange}
          />
        ) : (
          <p className="text-sm text-ink-muted">No manifest found for this model.</p>
        )}
      </div>
    </div>
  );
}

// --- panes -------------------------------------------------------------------

function HardwareChip() {
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);
  useEffect(() => {
    kwesiHardware.gpuVram().then(setGpu);
  }, []);
  if (!gpu?.available) return null;
  return (
    <div
      className="kwesi-glass hidden items-center gap-2 rounded-chip px-3 py-1.5 text-[11px] text-ink-muted lg:flex"
      title={`${gpu.freeVramGb?.toFixed(1) ?? "?"}GB of ${gpu.totalVramGb?.toFixed(1) ?? "?"}GB VRAM free`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span className="max-w-[160px] truncate text-ink">{gpu.gpuName}</span>
      {gpu.totalVramGb !== undefined && <span>{gpu.totalVramGb.toFixed(0)}GB</span>}
    </div>
  );
}

function ProjectRail({
  projects,
  selectedId,
  onSelect,
  onRequestDelete,
}: {
  projects: ProjectRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestDelete: (project: ProjectRow) => void;
}) {
  return (
    <div className="flex min-h-0 w-44 shrink-0 flex-col border-r border-ink/10 p-3 xl:w-52">
      <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        Projects · {projects.length}
      </p>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {projects.map((project) => {
          const selected = project.id === selectedId;
          return (
            <li key={project.id} className="group relative">
              <button
                onClick={() => onSelect(project.id)}
                className={`w-full rounded-[10px] px-2.5 py-2 pr-8 text-left text-sm transition-colors duration-150 ${
                  selected ? "bg-ink/[0.1] text-ink" : "text-ink-muted hover:bg-ink/[0.05] hover:text-ink"
                }`}
              >
                <span className="block truncate">{project.name}</span>
              </button>
              <button
                onClick={() => onRequestDelete(project)}
                aria-label={`Delete ${project.name}`}
                className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-[6px] px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-red-500/10 hover:text-red-600 group-hover:block"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GenerationList({
  generations,
  selectedId,
  onSelect,
  onNew,
  projectName,
  artistProfiles,
  draftTrackName,
}: {
  generations: GenerationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  projectName: string;
  artistProfiles: ArtistProfile[];
  // Non-null while the new-generation form (NewGenerationPane) is open —
  // mirrors its track-name field live, appended as the list's last item, so
  // typing a name reflects here before the generation is actually submitted
  // and becomes a real GenerationRow. Removed the moment the form is
  // cancelled or submitted.
  draftTrackName: string | null;
}) {
  const isDrafting = draftTrackName !== null;
  const hasItems = generations.length > 0 || isDrafting;

  return (
    <div className="flex min-h-0 w-60 shrink-0 flex-col border-r border-ink/10 xl:w-[19rem]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink/10 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{projectName}</h2>
          <p className="text-[11px] text-ink-muted">
            {generations.length === 0
              ? "No tracks yet"
              : `${generations.length} track${generations.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <PillButton className="!px-3 !py-1.5 text-xs" onClick={onNew}>
          + New
        </PillButton>
      </div>

      {!hasItems ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-xs text-ink-muted">
            Nothing here yet — hit <span className="text-ink">+ New</span> to generate something.
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {generations.map((generation) => {
            // While drafting, the pane on the right shows the form, not any
            // existing generation — so nothing from the real list should
            // still read as "selected" underneath it.
            const selected = !isDrafting && generation.id === selectedId;
            const params = parseParams(generation);
            const artist = artistProfiles.find((p) => p.id === params.artist_profile_id) ?? null;
            return (
              <li key={generation.id}>
                <button
                  onClick={() => onSelect(generation.id)}
                  className={`flex w-full items-start gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150 ${
                    selected ? "bg-ink/[0.1]" : "hover:bg-ink/[0.05]"
                  }`}
                >
                  {artist && <AvatarImage avatarPath={artist.avatarPath} name={artist.name} size={22} />}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs ${selected ? "text-ink" : "text-ink-muted"}`}>
                      {generationTitle(generation)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <StatusChip status={generation.status} />
                      <span className="truncate text-[10px] text-ink-muted">
                        {formatRelativeTime(generation.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {isDrafting && (
            <li>
              <div className="flex w-full items-start gap-2 rounded-[10px] border border-dashed border-ink/15 bg-ink/[0.05] px-3 py-2.5 text-left">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink">{draftTrackName.trim() || "Untitled track"}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Chip tone="live">Draft</Chip>
                  </div>
                </div>
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ParamsGrid({ generation, manifest }: { generation: GenerationRow; manifest: ModelManifest | undefined }) {
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
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-3">
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

function GenerationDetail({
  generation,
  projectName,
  modelId,
  artistProfiles,
  onDelete,
}: {
  generation: GenerationRow;
  projectName: string;
  modelId: string;
  artistProfiles: ArtistProfile[];
  onDelete: () => void;
}) {
  const [progressPct, setProgressPct] = useState(0);

  useEffect(() => {
    setProgressPct(0);
    const unsubscribe = kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "server_status") return;
      if (event.generationId !== generation.id) return;
      if (event.type === "running") setProgressPct(event.progressPct);
    });
    return unsubscribe;
  }, [generation.id]);

  const manifest = getManifest(modelId);
  const params = parseParams(generation);
  const done = generation.status === "done";
  const outputKind = generation.output_kind as "audio" | "midi" | "audio+midi" | null;
  const outputFiles = useMemo(() => parseOutputFiles(generation.output_files), [generation.output_files]);
  const audioFile = useMemo(() => findAudioFile(outputFiles), [outputFiles]);
  const midiFile = useMemo(() => findMidiFile(outputFiles), [outputFiles]);
  const showAudioPlayer = done && (outputKind === "audio" || outputKind === "audio+midi") && Boolean(audioFile);
  const showPianoRoll = done && (outputKind === "midi" || outputKind === "audio+midi") && Boolean(midiFile);

  const lyrics = LYRICS_KEYS.map((key) => params[key]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const prompt = PROMPT_KEYS.map((key) => params[key]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const trackName = generationTitle(generation);
  const artist = artistProfiles.find((p) => p.id === params.artist_profile_id) ?? null;
  const genres = Array.isArray(params.artist_genres) ? (params.artist_genres as string[]) : [];
  const playerTitle =
    typeof params.music_name === "string" && params.music_name.trim()
      ? params.music_name.trim()
      : `${projectName} — ${generation.checkpoint_variant ?? "track"}`;
  const hasPlayArea = !done || showAudioPlayer || showPianoRoll;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/10 px-6 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {artist && <AvatarImage avatarPath={artist.avatarPath} name={artist.name} size={40} className="mt-0.5" />}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{trackName}</h2>
            {artist && <p className="truncate text-xs text-ink-muted">by {artist.name}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusChip status={generation.status} />
            {generation.checkpoint_variant && <Chip>{generation.checkpoint_variant}</Chip>}
            {genres.map((genre) => (
              <Chip key={genre}>{genre}</Chip>
            ))}
            {done && <LicenseBadge modelId={modelId} />}
            <span className="text-[11px] text-ink-muted">{formatRelativeTime(generation.created_at)}</span>
            {done && generation.duration_ms !== null && (
              <span className="text-[11px] text-ink-muted" title="Time this generation took to run">
                · {(generation.duration_ms / 1000).toFixed(1)}s to generate
              </span>
            )}
            </div>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="shrink-0 rounded-[8px] px-2 py-1 text-xs text-ink-muted transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600"
        >
          Delete
        </button>
      </div>

      {/* The play area is pinned outside the scroll region — it's the one
          thing you want visible no matter how far you've scrolled into a
          long lyrics block or a long parameter list below it. */}
      {hasPlayArea && (
        <div className="shrink-0 border-b border-ink/10 px-6 py-5">
          {!done && (
            <OutputViewerPlaceholder
              outputKind={outputKind ?? "audio"}
              status={generation.status as GenerationStatus}
              progressPct={progressPct}
              error={generation.error}
            />
          )}
          {showAudioPlayer && (
            <WaveformPlayer
              generationId={generation.id}
              filePath={audioFile as string}
              title={playerTitle}
              compact={false}
            />
          )}
          {showPianoRoll && <PianoRollViewer filePath={midiFile as string} title={playerTitle} compact={false} />}
        </div>
      )}

      {/* Everything below the play area is one shared scroll region — lyrics
          render at their full natural height (no inner scrollbox of their
          own) rather than being trapped in a small max-height box. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-6 py-5">
        {prompt && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Prompt</p>
            {/* max-w-[70ch] keeps prose at a comfortable reading measure —
                the pane itself can be 800px+ wide on a large window, which
                without this cap stretched a one-sentence prompt across the
                full width (~125ch), well past the 65-75ch a line of text
                stays readable at. */}
            <p className="max-w-[70ch] rounded-[12px] bg-ink/[0.04] px-4 py-3 text-sm leading-relaxed">{prompt}</p>
          </div>
        )}

        {lyrics && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Lyrics</p>
            <pre className="max-w-[70ch] whitespace-pre-wrap rounded-[12px] bg-ink/[0.04] px-4 py-3 font-sans text-sm leading-relaxed">
              {lyrics}
            </pre>
          </div>
        )}

        <ParamsGrid generation={generation} manifest={manifest} />

        {outputFiles.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Output files</p>
            <ul className="flex flex-col gap-1">
              {outputFiles.map((file) => (
                <li
                  key={file}
                  className="truncate rounded-[8px] bg-ink/[0.04] px-3 py-1.5 text-[11px] text-ink-muted"
                  title={file}
                >
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPane({
  project,
  modelId,
  variants,
  artistProfiles,
}: {
  project: ProjectRow;
  modelId: string;
  variants: ModelVariantRow[];
  artistProfiles: ArtistProfile[];
}) {
  const [generations, setGenerations] = useState<GenerationRow[] | null>(null);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);
  // Non-null means the new-generation form is open in the right-hand pane,
  // in place of GenerationDetail — its value is the form's live track name,
  // mirrored into GenerationList's appended draft item. null means the form
  // is closed, whether it was never opened, cancelled, or just submitted.
  const [draftTrackName, setDraftTrackName] = useState<string | null>(null);

  const installedVariantNames = useMemo(
    () => variants.filter((v) => v.install_status === "installed").map((v) => v.variant_name),
    [variants],
  );
  // Phase 10: trained-model variants (model_variant rows created by
  // trainingManager.ts on a completed run, source === "trained") aren't part
  // of the manifest's static checkpointVariants list — merged in separately,
  // since DynamicGenerationForm treats them as always-usable regardless of
  // the static catalog list.
  const trainedVariantNames = useMemo(
    () =>
      variants
        .filter((v) => v.install_status === "installed" && v.source === "trained")
        .map((v) => v.variant_name),
    [variants],
  );

  async function refresh() {
    setGenerations(await kwesiDb.listGenerations(project.id));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const unsubscribe = kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "server_status") return;
      if (event.projectId !== project.id) return;
      refresh();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Keep a generation selected whenever one exists, so the detail pane is
  // never empty next to a populated list.
  useEffect(() => {
    if (!generations) return;
    const stillExists = generations.some((g) => g.id === selectedGenerationId);
    if (!stillExists) setSelectedGenerationId(generations[0]?.id ?? null);
  }, [generations, selectedGenerationId]);

  async function submitGeneration(checkpointVariant: string | null, values: Record<string, unknown>) {
    const manifest = getManifest(modelId);
    if (!manifest) return;
    const result = await kwesiGeneration.submit(project.id, checkpointVariant, values, outputKindOf(manifest));
    if (result.ok) {
      setDraftTrackName(null);
      if (result.generation) setSelectedGenerationId(result.generation.id);
      refresh();
    }
  }

  async function removeGeneration(id: string) {
    await kwesiDb.deleteGeneration(id, true);
    refresh();
  }

  // Selecting an existing track always exits the draft — the right-hand
  // pane can only show one thing at a time, and a half-filled form with no
  // save prompt isn't worth preserving across that switch.
  function selectGeneration(id: string) {
    setDraftTrackName(null);
    setSelectedGenerationId(id);
  }

  const selectedGeneration = generations?.find((g) => g.id === selectedGenerationId) ?? null;
  const isDrafting = draftTrackName !== null;

  return (
    <>
      <GenerationList
        generations={generations ?? []}
        selectedId={selectedGenerationId}
        onSelect={selectGeneration}
        onNew={() => setDraftTrackName("")}
        projectName={project.name}
        artistProfiles={artistProfiles}
        draftTrackName={draftTrackName}
      />

      {isDrafting ? (
        <NewGenerationPane
          modelId={modelId}
          installedVariantNames={installedVariantNames}
          extraVariantNames={trainedVariantNames}
          artistProfiles={artistProfiles}
          onCancel={() => setDraftTrackName(null)}
          onSubmit={submitGeneration}
          onTrackNameChange={setDraftTrackName}
        />
      ) : selectedGeneration ? (
        <GenerationDetail
          key={selectedGeneration.id}
          generation={selectedGeneration}
          projectName={project.name}
          modelId={modelId}
          artistProfiles={artistProfiles}
          onDelete={() => removeGeneration(selectedGeneration.id)}
        />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<WaveformIcon width={28} height={28} />}
            title="Nothing generated in this project yet."
            action={<PillButton onClick={() => setDraftTrackName("")}>Create your first track</PillButton>}
          />
        </div>
      )}
    </>
  );
}

// --- screen ------------------------------------------------------------------

export function WorkspaceDetailScreen() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [variants, setVariants] = useState<ModelVariantRow[]>([]);
  const [artistProfiles, setArtistProfiles] = useState<ArtistProfile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<ProjectRow | null>(null);
  const [deleteFilesToo, setDeleteFilesToo] = useState(false);

  async function refresh() {
    if (!workspaceId) return;
    const all = await kwesiDb.listWorkspaces();
    const found = all.find((w) => w.id === workspaceId) ?? null;
    setWorkspace(found);
    setProjects(await kwesiDb.listProjects(workspaceId));
    if (found) setVariants(await kwesiDb.listModelVariants(found.model_id));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    kwesiArtistProfiles.list().then(setArtistProfiles);
  }, []);

  // Keep a project selected whenever one exists — an empty pane next to a
  // populated rail is just dead space.
  useEffect(() => {
    if (!projects) return;
    const stillExists = projects.some((p) => p.id === selectedProjectId);
    if (!stillExists) setSelectedProjectId(projects[0]?.id ?? null);
  }, [projects, selectedProjectId]);

  if (!workspaceId) return null;

  const selectedProject = projects?.find((p) => p.id === selectedProjectId) ?? null;
  const installedCount = variants.filter((v) => v.install_status === "installed").length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={workspace?.name ?? "…"}
        backTo="/workspaces"
        backLabel="Workspaces"
        subtitle={
          <>
            <span>{workspace?.model_display_name}</span>
            {installedCount > 0 && (
              <span>
                {" "}
                · {installedCount} checkpoint{installedCount === 1 ? "" : "s"} installed
              </span>
            )}
          </>
        }
        actions={
          <>
            <HardwareChip />
            <PillButton onClick={() => setShowNewProject(true)}>New Project</PillButton>
          </>
        }
      />

      {projects === null ? null : projects.length === 0 ? (
        <GlassPanel className="flex min-h-0 flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<WorkspacesIcon width={28} height={28} />}
            title="No projects yet in this workspace."
            action={<PillButton onClick={() => setShowNewProject(true)}>Create your first project</PillButton>}
          />
        </GlassPanel>
      ) : (
        <GlassPanel radius="panel" className="flex min-h-0 flex-1 overflow-hidden">
          <ProjectRail
            projects={projects}
            selectedId={selectedProjectId}
            onSelect={setSelectedProjectId}
            onRequestDelete={(project) => {
              setDeleteFilesToo(false);
              setProjectPendingDelete(project);
            }}
          />
          {selectedProject && (
            <ProjectPane
              key={selectedProject.id}
              project={selectedProject}
              modelId={workspace?.model_id ?? ""}
              variants={variants}
              artistProfiles={artistProfiles}
            />
          )}
        </GlassPanel>
      )}

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={async (name) => {
            const created = await kwesiDb.createProject(workspaceId, name);
            setShowNewProject(false);
            await refresh();
            setSelectedProjectId(created.id);
          }}
        />
      )}

      {projectPendingDelete && (
        <ConfirmDialog
          title={`Delete "${projectPendingDelete.name}"?`}
          description={
            <div className="flex flex-col gap-2.5">
              <p>This removes the project and every generation inside it.</p>
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={deleteFilesToo}
                  onChange={(e) => setDeleteFilesToo(e.target.checked)}
                />
                Also delete the files on disk
              </label>
            </div>
          }
          onCancel={() => setProjectPendingDelete(null)}
          onConfirm={async () => {
            await kwesiDb.deleteProject(projectPendingDelete.id, deleteFilesToo);
            setProjectPendingDelete(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
