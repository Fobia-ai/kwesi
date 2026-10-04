import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassPanel } from "../components/ui/GlassPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { PillButton } from "../components/ui/PillButton";
import { EmptyState } from "../components/ui/EmptyState";
import { TrainingIcon } from "../components/ui/icons";
import { MANIFESTS, type ModelManifest, type TrainingSupportedConfig } from "../data/manifests";
import {
  FieldControl,
  defaultValueFor,
  evaluateHardwareGate,
  HardwareGateBanner,
  type GenerationFormValues,
} from "../components/generation/DynamicGenerationForm";
import { kwesiHardware, type GpuVramInfo } from "../lib/hardware";
import { kwesiTraining, type TrainingDiskCheck, type TrainingProgressEvent } from "../lib/training";
import { kwesiEnvironment, type MusecocoGpuStatus } from "../lib/environment";
import { kwesiDb, type TrainedModelRow, type TrainingRunRow } from "../lib/db";
import { ModelSetupDialog } from "../components/models/ModelSetupDialog";
import { InfoHint } from "../components/ui/InfoHint";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Callout } from "../components/ui/Callout";
import { InsetCard } from "../components/ui/InsetCard";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { estimateTrainingSeconds, formatEstimate } from "../lib/trainingEstimate";
import { PreviewButton } from "../components/training/PreviewButton";
import { LogPanel } from "../components/ui/LogPanel";
import { AlertIcon, CheckCircleIcon, CloseIcon } from "../components/ui/icons";
import { useDatasetCheck, type ClipProbe } from "../lib/datasetCheck";
import { formatDuration } from "../lib/format";
import type { ManifestInput } from "../data/manifests";

// Plain-language explanations of the training jargon, keyed by hyperparameter
// key. Shown in the info hover-card next to each technical label (combined
// with the manifest's model-specific helpText when present). Keeps the "what
// does this value mean/do" answer in one editable place rather than scattered.
const TERM_GLOSSARY: Record<string, string> = {
  base_variant:
    "The pretrained checkpoint your fine-tune starts from. Training nudges this existing model toward your dataset rather than learning from scratch — bigger bases capture more nuance but need more time and VRAM.",
  config:
    "Which model size/architecture to train. Smaller configs train faster and fit in less VRAM; larger ones can sound better but cost more to run.",
  rank:
    "LoRA rank — how much new, trainable capacity the adapter adds on top of the frozen base. Higher = more room to learn your dataset's character, but slower and easier to overfit on a small dataset.",
  alpha:
    "LoRA alpha — a scaling factor on how strongly the adapter affects the base model. Commonly around 2× the rank; raising it makes the fine-tune's influence more pronounced.",
  epochs:
    "How many full passes the trainer makes over your whole dataset. More epochs = more learning, but too many and the model just memorizes your clips (overfitting) instead of generalizing.",
  max_steps:
    "The total number of training updates (one gradient step each). The defaults here are deliberately small to prove the pipeline produces a real checkpoint — a musically finished model needs far more.",
  max_updates:
    "The total number of training updates (forward + backward passes). Kept small here for a quick, pipeline-proving run rather than a fully-trained model.",
  learning_rate:
    "How big a step the optimizer takes on each update. Too high and training becomes unstable or diverges; too low and it barely learns. The default is a safe starting point.",
  batch_size:
    "How many clips are processed together in one step. Larger batches train more smoothly but use more VRAM; 1 is the safest on limited memory.",
};

function hintTextFor(input: ManifestInput): string | null {
  const parts = [TERM_GLOSSARY[input.key], input.helpText].filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  preparing: "Preparing dataset",
  running: "Training",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

function StatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "completed"
      ? "success"
      : status === "failed" || status === "interrupted"
        ? "bad"
        : status === "cancelled"
          ? "neutral"
          : "live";
  const active = status === "running" || status === "preparing" || status === "queued";
  return (
    <Badge tone={tone} pulse={active}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function resolveUploadedFilePath(file: File): string {
  const realPath = window.kwesi?.getFilePathForUpload(file);
  return realPath && realPath.length > 0 ? realPath : file.name;
}

// Caption/subtitle sidecar file types accepted in "From files" mode. CSV/JSON
// are deliberately NOT here -- those are whole-dataset maps, handled by the
// bulk import in "Type manually" mode, not one-file-per-clip sidecars.
const CAPTION_EXTS = [".txt", ".lrc", ".srt", ".vtt"];

function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot === -1 ? name : name.slice(0, dot)).toLowerCase();
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Turns a caption/subtitle file's raw text into a single plain caption:
 * .srt/.vtt drop their index + "00:00 --> 00:00" timing lines, .lrc drops its
 * "[mm:ss.xx]" tags, .txt is used as-is. The real backends (ACE-Step's
 * train.py, MusicGen's dora manifest) just want one caption string per clip.
 */
function parseCaptionText(filename: string, raw: string): string {
  const ext = fileExt(filename);
  if (ext === ".srt" || ext === ".vtt") {
    return raw
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^WEBVTT/i.test(l.trim()) && !/^\d+$/.test(l.trim()) && !l.includes("-->"))
      .join(" ")
      .trim();
  }
  if (ext === ".lrc") {
    return raw
      .split(/\r?\n/)
      .map((l) => l.replace(/\[[0-9:.]+\]/g, "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return raw.trim();
}

/** Pairs each audio file with a caption file of the same stem (song1.wav ↔ song1.txt). */
function autoMatchCaptions(audioFiles: File[], captionFiles: File[]): Record<string, string> {
  const pairing: Record<string, string> = {};
  for (const audio of audioFiles) {
    const match = captionFiles.find((c) => fileStem(c.name) === fileStem(audio.name));
    if (match) pairing[audio.name] = match.name;
  }
  return pairing;
}

/**
 * Phase 11 / dynamic training dataset: the real per-clip caption input for
 * `inputKind === "audio_captioned"` models (ACE-Step 1.5, MusicGen), whose
 * tooling reads a text caption alongside each audio clip. Two ways to supply
 * them, toggled:
 *   - "From files": drop audio AND caption/subtitle files (together or
 *     separately); each clip auto-pairs with the same-named caption file, and
 *     any mismatch is re-pairable per row via the dropdown. The file's text is
 *     read at submit time (subtitles get their timestamps stripped).
 *   - "Type manually": type a caption per clip, or bulk-import a
 *     filename,caption CSV/JSON.
 * Captions stay optional either way -- both backends fall back to a
 * filename-derived caption, so this never hard-blocks a run.
 */
function CaptionedDataset({
  fileTypes,
  minFiles,
  audioFiles,
  onAudioFilesChange,
  captionMode,
  onCaptionModeChange,
  typedCaptions,
  onTypedCaptionsChange,
  captionFiles,
  onCaptionFilesChange,
  pairing,
  onPairingChange,
  durationOf,
}: {
  durationOf: (file: File) => ClipProbe | undefined;
  fileTypes: string[];
  minFiles: number;
  audioFiles: File[];
  onAudioFilesChange: (files: File[]) => void;
  captionMode: "files" | "text";
  onCaptionModeChange: (mode: "files" | "text") => void;
  typedCaptions: Record<string, string>;
  onTypedCaptionsChange: (next: Record<string, string>) => void;
  captionFiles: File[];
  onCaptionFilesChange: (files: File[]) => void;
  pairing: Record<string, string>;
  onPairingChange: (next: Record<string, string>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handlePicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const nextAudio = [...audioFiles];
    const nextCaption = [...captionFiles];
    const rejected: string[] = [];
    for (const file of Array.from(picked)) {
      const ext = fileExt(file.name);
      if (fileTypes.includes(ext)) nextAudio.push(file);
      else if (CAPTION_EXTS.includes(ext)) nextCaption.push(file);
      else rejected.push(`${file.name} (${ext || "no extension"})`);
    }
    setError(
      rejected.length > 0
        ? `Unsupported file${rejected.length === 1 ? "" : "s"} (expects audio ${fileTypes.join(", ")} or captions ${CAPTION_EXTS.join(", ")}): ${rejected.join(", ")}`
        : null,
    );
    onAudioFilesChange(nextAudio);
    onCaptionFilesChange(nextCaption);
    // Re-pair any audio that doesn't already have an explicit pairing.
    const auto = autoMatchCaptions(nextAudio, nextCaption);
    onPairingChange({ ...auto, ...pairing });
  }

  function removeAudio(index: number) {
    const removed = audioFiles[index];
    onAudioFilesChange(audioFiles.filter((_, i) => i !== index));
    if (removed) {
      const next = { ...pairing };
      delete next[removed.name];
      onPairingChange(next);
    }
  }

  async function handleBulkImport(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const next: Record<string, string> = { ...typedCaptions };
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text) as Record<string, string> | Array<{ filename: string; caption: string }>;
        if (Array.isArray(parsed)) {
          for (const row of parsed) if (row.filename) next[row.filename] = row.caption ?? "";
        } else {
          for (const [filename, caption] of Object.entries(parsed)) next[filename] = caption;
        }
      } else {
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const commaIdx = line.indexOf(",");
          if (commaIdx === -1) continue;
          const filename = line.slice(0, commaIdx).trim().replace(/^"|"$/g, "");
          const caption = line.slice(commaIdx + 1).trim().replace(/^"|"$/g, "");
          if (filename.toLowerCase() === "filename") continue;
          next[filename] = caption;
        }
      }
      onTypedCaptionsChange(next);
    } catch {
      setImportError('Couldn\'t parse that file — expected a CSV with "filename,caption" rows or a JSON object/array.');
    }
  }

  const matchedCount = audioFiles.filter((a) => pairing[a.name]).length;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-ink/20 px-4 py-6 text-center text-sm text-ink-muted transition-colors duration-150 hover:border-accent/50 hover:text-ink">
        <span>Drop audio{captionMode === "files" ? " + caption" : ""} files here, or choose them</span>
        <span className="text-xs">
          {audioFiles.length} audio{captionMode === "files" ? ` · ${captionFiles.length} caption` : ""} file
          {audioFiles.length === 1 && (captionMode !== "files" || captionFiles.length === 1) ? "" : "s"}
          {minFiles > 0 && ` — at least ${minFiles} audio needed`}
        </span>
        <input
          type="file"
          multiple
          accept={captionMode === "files" ? [...fileTypes, ...CAPTION_EXTS].join(",") : fileTypes.join(",")}
          className="hidden"
          onChange={(e) => {
            handlePicked(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error && <Callout tone="error">{error}</Callout>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
        <SegmentedControl
          ariaLabel="Caption source"
          value={captionMode}
          onChange={onCaptionModeChange}
          options={[
            { value: "files", label: "From files" },
            { value: "text", label: "Type manually" },
          ]}
        />
        <InfoHint
          label="caption source"
          text={`From files: drop a caption or subtitle file next to each audio clip and they pair up by name (song1.wav ↔ song1.txt). Supported: ${CAPTION_EXTS.join(", ")} — subtitle timestamps (.srt/.vtt/.lrc) are stripped automatically. Use a row's dropdown to fix any mismatch.\n\nType manually: write a caption per clip, or import a whole CSV/JSON of filename → caption.`}
        />
        </div>
        {captionMode === "files" ? (
          <span className="text-xs text-ink-muted">
            {matchedCount}/{audioFiles.length} matched
          </span>
        ) : (
          <label className="cursor-pointer text-xs text-accent hover:underline">
            Import CSV/JSON…
            <input
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={(e) => {
                void handleBulkImport(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {importError && <Callout tone="error">{importError}</Callout>}

      {audioFiles.length > 0 && (
        <div className="flex max-h-60 flex-col overflow-y-auto rounded-[10px] bg-ink/[0.03]">
          <div className="sticky top-0 flex items-center gap-2 border-b border-ink/[0.07] bg-ink/[0.03] px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            <span className="w-2/5 shrink-0">Audio clip</span>
            <span className="flex-1">Caption {captionMode === "files" ? "(matched file)" : "(optional)"}</span>
            <span className="w-6 shrink-0" />
          </div>
          {audioFiles.map((f, i) => {
            const matchedName = pairing[f.name];
            const matchedFile = matchedName ? captionFiles.find((c) => c.name === matchedName) : undefined;
            return (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 border-b border-ink/[0.05] px-2 py-1.5 last:border-b-0">
                <span className="flex w-2/5 shrink-0 items-center gap-1.5 text-xs" title={f.name}>
                  <span className="truncate">{f.name}</span>
                  <ClipLength probe={durationOf(f)} />
                </span>
                {captionMode === "files" ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <select
                      value={matchedName ?? ""}
                      onChange={(e) => {
                        const next = { ...pairing };
                        if (e.target.value) next[f.name] = e.target.value;
                        else delete next[f.name];
                        onPairingChange(next);
                      }}
                      className="kwesi-glass min-w-0 flex-1 rounded-[8px] px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="">— no caption —</option>
                      {captionFiles.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {matchedFile ? (
                      <CheckCircleIcon width={14} height={14} className="shrink-0 text-accent" aria-label="Matched" />
                    ) : (
                      <span title="No caption file — falls back to the filename" className="shrink-0">
                        <AlertIcon width={14} height={14} className="text-warning" aria-label="No caption" />
                      </span>
                    )}
                  </div>
                ) : (
                  <input
                    value={typedCaptions[f.name] ?? ""}
                    onChange={(e) => onTypedCaptionsChange({ ...typedCaptions, [f.name]: e.target.value })}
                    placeholder="Describe this clip (optional — falls back to the filename)"
                    className="kwesi-glass min-w-0 flex-1 rounded-[8px] px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent/40"
                  />
                )}
                <button
                  type="button"
                  className="flex w-6 shrink-0 justify-center text-ink-muted transition-colors hover:text-danger"
                  onClick={() => removeAudio(i)}
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                >
                  <CloseIcon width={13} height={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {captionMode === "files" && captionFiles.length > 0 && matchedCount < captionFiles.length && (
        <p className="text-xs text-ink-muted">
          {captionFiles.length - matchedCount} caption file{captionFiles.length - matchedCount === 1 ? "" : "s"} not matched to any clip — use the dropdowns above to pair them.
        </p>
      )}
    </div>
  );
}

/** Builds the audioBasename→caption map the backend wants, reading caption files as needed. */
async function resolveCaptions(
  captionMode: "files" | "text",
  audioFiles: File[],
  typedCaptions: Record<string, string>,
  captionFiles: File[],
  pairing: Record<string, string>,
): Promise<Record<string, string>> {
  if (captionMode === "text") return typedCaptions;
  const out: Record<string, string> = {};
  for (const audio of audioFiles) {
    const capName = pairing[audio.name];
    if (!capName) continue;
    const capFile = captionFiles.find((c) => c.name === capName);
    if (!capFile) continue;
    const parsed = parseCaptionText(capFile.name, await capFile.text());
    if (parsed) out[audio.name] = parsed;
  }
  return out;
}

/** A clip's length in a file list, or why it's unknown. */
function ClipLength({ probe }: { probe: ClipProbe | undefined }) {
  if (!probe) return <span className="shrink-0 text-[10px] text-ink-muted/60">…</span>;
  if (probe.status === "ok")
    return probe.durationSec === null ? null : <span className="shrink-0 tabular-nums text-[10px] text-ink-muted">{formatDuration(probe.durationSec)}</span>;
  if (probe.status === "unknown") return <span className="shrink-0 text-[10px] text-ink-muted/60">?:??</span>;
  return <span className="shrink-0 text-[10px] text-danger">{probe.status === "empty" ? "empty" : "unreadable"}</span>;
}

/** "3 clips · 1:30 total" (or "6 MIDI files") plus whatever the dataset check found. */
function DatasetSummary({ count, check, midi = false }: { count: number; check: ReturnType<typeof useDatasetCheck>; midi?: boolean }) {
  if (count === 0 || !check.result) return null;
  const { result, checking } = check;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-ink-muted">
        {midi
          ? `${count} MIDI file${count === 1 ? "" : "s"}`
          : `${count} clip${count === 1 ? "" : "s"} · ${formatDuration(result.totalSec)} total`}
        {checking ? " · checking…" : ""}
      </p>
      {!checking &&
        result.issues.map((issue) => (
          <Callout key={issue.message} tone={issue.tone}>
            {issue.message}
          </Callout>
        ))}
      {!checking && result.issues.length === 0 && <Callout tone="success">Dataset looks good.</Callout>}
    </div>
  );
}

function DatasetDropZone({
  fileTypes,
  minFiles,
  files,
  onFilesChange,
  durationOf,
}: {
  fileTypes: string[];
  minFiles: number;
  files: File[];
  onFilesChange: (files: File[]) => void;
  durationOf: (file: File) => ClipProbe | undefined;
}) {
  const [error, setError] = useState<string | null>(null);

  function handlePicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(picked)) {
      const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (fileTypes.includes(ext)) accepted.push(file);
      else rejected.push(`${file.name} (${ext || "no extension"})`);
    }
    if (rejected.length > 0) {
      setError(
        `${rejected.length === 1 ? "This file isn't" : "These files aren't"} a supported type for this model (expects ${fileTypes.join(", ")}): ${rejected.join(", ")}`,
      );
    } else {
      setError(null);
    }
    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-ink/20 px-4 py-8 text-center text-sm text-ink-muted transition-colors duration-150 hover:border-accent/50 hover:text-ink">
        <span>
          Drop or choose {fileTypes.every((t) => t === ".mid" || t === ".midi") ? "MIDI" : "audio"} files ({fileTypes.join(", ")})
        </span>
        <span className="text-xs">
          {files.length} file{files.length === 1 ? "" : "s"} selected
          {minFiles > 0 && ` — at least ${minFiles} needed`}
        </span>
        <input
          type="file"
          multiple
          accept={fileTypes.join(",")}
          className="hidden"
          onChange={(e) => {
            handlePicked(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error && <Callout tone="error">{error}</Callout>}
      {files.length > 0 && (
        <ul className="flex max-h-40 flex-col overflow-y-auto rounded-[10px] bg-ink/[0.03] text-xs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 border-b border-ink/[0.05] px-2 py-1.5 last:border-b-0">
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <ClipLength probe={durationOf(f)} />
              <button
                type="button"
                className="flex w-6 shrink-0 justify-center text-ink-muted transition-colors hover:text-danger"
                onClick={() => onFilesChange(files.filter((_, idx) => idx !== i))}
                title="Remove"
                aria-label={`Remove ${f.name}`}
              >
                <CloseIcon width={13} height={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The installed checkpoint a training run fine-tunes from, when it needs one
 * on disk: ACE-Step's chosen base DiT (Side-Step alias -> install variant
 * name, same mapping as trainingManager.ts), MuseCoco's single checkpoint.
 * RAVE trains from scratch and MusicGen fetches its base through
 * AudioCraft's own //pretrained alias, so neither needs local weights.
 */
function requiredBaseVariant(modelId: string, hyperparams: GenerationFormValues): string | null {
  if (modelId === "ace-step-1.5") {
    const alias = typeof hyperparams.base_variant === "string" && hyperparams.base_variant ? hyperparams.base_variant : "turbo";
    return `acestep-v15-${alias.replace(/_/g, "-")}`;
  }
  if (modelId === "musecoco") return "default";
  return null;
}

/**
 * MuseCoco-only: builds the optional CUDA attention kernel (see
 * electron/models/musecocoGpu.ts). Lives here rather than in install/setup
 * because it's an opt-in, one-time ~5 minute build mainly worth it for
 * training; generation picks the kernel up on its own once it exists.
 */
function MusecocoGpuCard({ onBuilt }: { onBuilt?: () => void }) {
  const [status, setStatus] = useState<MusecocoGpuStatus | null>(null);
  const [building, setBuilding] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    kwesiEnvironment.musecocoGpuStatus().then(setStatus);
  }, []);

  useEffect(
    () =>
      kwesiEnvironment.onProgress((event) => {
        if (event.modelId !== "musecoco") return;
        setLog((prev) => [...prev.slice(-29), event.line]);
      }),
    [],
  );

  async function build() {
    setError(null);
    setLog([]);
    setBuilding(true);
    const result = await kwesiEnvironment.buildMusecocoGpu();
    setBuilding(false);
    if (!result.ok) setError(result.reason ?? "Build failed.");
    else onBuilt?.();
    setStatus(await kwesiEnvironment.musecocoGpuStatus());
  }

  if (!status) return null;
  const description = status.built
    ? "Built. Training runs on your GPU (~1s per update) whenever 16GB of VRAM is free, otherwise on the CPU. Generation uses it too."
    : status.supported
      ? "Not built — training runs on the CPU (~50s per update). Build it once to train about 50× faster."
      : (status.reason ?? "Not available on this system.");

  return (
    <InsetCard>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            GPU acceleration
            <InfoHint
              label="GPU acceleration"
              text={
                "MuseCoco's attention layer runs through a compiled kernel that a normal install builds for the CPU only — compiling the GPU version needs a CUDA 11.3 compiler almost no machine has.\n\nThis downloads a pinned, one-time build toolchain (~1GB, deleted afterwards), compiles the GPU kernel (about 5 minutes), checks it against the CPU kernel on your GPU, and only then installs it.\n\nOn the GPU, training uses the Adafactor optimizer instead of Adam so the 1B-parameter model fits in memory. Linux with an NVIDIA GPU only."
              }
            />
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{building ? "Building… this takes several minutes." : description}</p>
        </div>
        {status.supported && (
          <PillButton size="sm" variant={status.built ? "ghost" : "accent"} onClick={build} disabled={building}>
            {building ? "Building…" : status.built ? "Rebuild" : "Build GPU kernel"}
          </PillButton>
        )}
      </div>
      <LogPanel lines={log} className="mt-2" />
      {error && <Callout tone="error" className="mt-2">{error}</Callout>}
    </InsetCard>
  );
}

function NewTrainingRunForm({ onSubmitted, trainedVersion }: { onSubmitted: () => void; trainedVersion: number }) {
  const trainableModels = useMemo(() => Object.values(MANIFESTS), []);
  const [modelId, setModelId] = useState<string>("");
  // Continue training one of the user's own models instead of the stock base.
  const [trainedForModel, setTrainedForModel] = useState<TrainedModelRow[]>([]);
  const [continueFrom, setContinueFrom] = useState<string>("");
  const [runName, setRunName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [datasetCaptions, setDatasetCaptions] = useState<Record<string, string>>({});
  const [captionMode, setCaptionMode] = useState<"files" | "text">("files");
  const [captionFiles, setCaptionFiles] = useState<File[]>([]);
  const [captionPairing, setCaptionPairing] = useState<Record<string, string>>({});
  const [hyperparams, setHyperparams] = useState<GenerationFormValues>({});
  const [outputDir, setOutputDir] = useState<string>("");
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  function resetDataset() {
    setFiles([]);
    setDatasetCaptions({});
    setCaptionFiles([]);
    setCaptionPairing({});
  }

  useEffect(() => {
    kwesiHardware.gpuVram().then(setGpu);
  }, []);

  const manifest = modelId ? MANIFESTS[modelId] : undefined;
  const training =
    manifest && manifest.training.supported ? (manifest.training as TrainingSupportedConfig) : undefined;
  const isMidiDataset = training ? training.inputKind === "midi" : false;
  const isCaptionedDataset = training ? training.inputKind === "audio_captioned" : false;

  useEffect(() => {
    if (!training) {
      setHyperparams({});
      return;
    }
    const initial: GenerationFormValues = {};
    for (const input of training.hyperparameters) initial[input.key] = defaultValueFor(input);
    setHyperparams(initial);
  }, [training]);

  useEffect(() => {
    if (!modelId || !runName.trim()) return;
    kwesiTraining.defaultOutputDir(modelId, runName.trim()).then(setOutputDir);
  }, [modelId, runName]);

  async function choosePickOutputDir() {
    if (!modelId) return;
    const result = await kwesiTraining.pickOutputDir(modelId, runName.trim() || "run");
    if (result.ok && result.path) setOutputDir(result.path);
  }

  const hardwareGate = training ? evaluateHardwareGate(manifest!, training.hardware.minVramGb, gpu) : { level: "ok" as const };

  useEffect(() => {
    setContinueFrom("");
  }, [modelId]);
  // Re-fetched when a run finishes too, so a model trained moments ago can
  // be continued without re-picking the base model.
  useEffect(() => {
    if (!modelId) {
      setTrainedForModel([]);
      return;
    }
    kwesiTraining.listTrainedModels(modelId).then(setTrainedForModel);
  }, [modelId, trainedVersion]);
  const continueSource = trainedForModel.find((t) => t.id === continueFrom) ?? null;
  const locked = continueSource?.continue_info.locked ?? {};
  // Keep the settings the source fixes in place whenever it changes.
  useEffect(() => {
    if (continueSource) setHyperparams((prev) => ({ ...prev, ...continueSource.continue_info.locked }));
  }, [continueSource]);
  const unlockedValues = (values: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(values).filter(([k]) => !(k in locked)));

  // Presets: the one whose values all match the current settings is shown
  // as selected; anything else reads as "Custom".
  const activePreset =
    training?.presets.find((p) =>
      Object.entries(unlockedValues(p.values)).every(([k, v]) => String(hyperparams[k]) === String(v)),
    ) ?? null;
  const [museCocoGpuBuilt, setMuseCocoGpuBuilt] = useState(false);
  useEffect(() => {
    if (modelId === "musecoco") kwesiEnvironment.musecocoGpuStatus().then((st) => setMuseCocoGpuBuilt(st.built));
  }, [modelId]);
  const estimateFor = (values: GenerationFormValues) =>
    estimateTrainingSeconds(modelId, values, {
      fileCount: files.length,
      // Idle model servers are stopped before a run, so total VRAM is what counts.
      museCocoOnGpu: museCocoGpuBuilt && (gpu?.totalVramGb ?? 0) >= 16,
    });
  const currentEstimate = training ? estimateFor(hyperparams) : null;

  // Re-checked (debounced) whenever anything that changes the estimate does.
  const [disk, setDisk] = useState<TrainingDiskCheck | null>(null);
  const datasetBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  useEffect(() => {
    if (!modelId || !outputDir) {
      setDisk(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      kwesiTraining.diskCheck({ modelId, outputDir, hyperparams, datasetBytes }).then((r) => {
        if (!cancelled) setDisk(r);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modelId, outputDir, hyperparams, datasetBytes]);
  const datasetCheck = useDatasetCheck(files, training?.datasetRequirements);
  const meetsFileMinimum = files.length > 0 && !datasetCheck.checking && !datasetCheck.result?.blocking;

  // Gate on the training environment (a model trains in a venv that may
  // differ from its inference one -- RAVE in `rave-train`) and on the base
  // weights the run fine-tunes from. Without this the run starts, then fails
  // deep in the pipeline with a raw "venv/checkpoint not found" -- same
  // late-failure UX the generation gate fixed.
  const baseVariant = manifest ? requiredBaseVariant(manifest.modelId, hyperparams) : null;
  async function startRun() {
    if (!training || !manifest) return;
    const [env, variants] = await Promise.all([
      kwesiEnvironment.checkTrainingStatus(manifest.modelId),
      baseVariant ? kwesiDb.listModelVariants(manifest.modelId) : Promise.resolve([]),
    ]);
    const baseReady = !baseVariant || variants.some((v) => v.variant_name === baseVariant && v.install_status === "installed");
    if (!env.venvExists || !baseReady) {
      setSetupOpen(true);
      return;
    }
    await handleSubmit();
  }

  async function handleSubmit() {
    if (!training || !manifest) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const datasetFiles = files.map(resolveUploadedFilePath).filter((p) => p.length > 0);
      const result = await kwesiTraining.submit({
        modelId: manifest.modelId,
        baseCheckpointVariant: null,
        runName: runName.trim(),
        datasetFiles,
        allowedExtensions: training.datasetRequirements.fileTypes,
        hyperparams,
        outputDir: outputDir || (await kwesiTraining.defaultOutputDir(manifest.modelId, runName.trim())),
        datasetCaptions: isCaptionedDataset
          ? await resolveCaptions(captionMode, files, datasetCaptions, captionFiles, captionPairing)
          : undefined,
        continueFrom: continueSource ? continueSource.id : undefined,
      });
      if (!result.ok) {
        setSubmitError(result.reason ?? "Could not start this training run.");
        return;
      }
      resetDataset();
      setRunName("");
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-b border-ink/10 p-5">
      <h2 className="text-sm font-semibold">New Training Run</h2>

      <label className="flex flex-col gap-1.5 text-sm">
        Base model
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            resetDataset();
          }}
          className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="" disabled>
            Select a model…
          </option>
          {trainableModels.map((m) => (
            <option key={m.modelId} value={m.modelId} disabled={!m.training.supported}>
              {m.displayName}
              {!m.training.supported ? " (not available for training yet)" : ""}
            </option>
          ))}
        </select>
      </label>

      {manifest && !manifest.training.supported && (
        <p className="rounded-[10px] bg-ink/[0.04] px-3 py-2 text-xs text-ink-muted">{manifest.training.reason}</p>
      )}

      {training && manifest && (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            Run name
            <input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="e.g. my-synth-timbre"
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>

          {trainedForModel.length > 0 && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="flex items-center gap-1.5">
                Start from
                <InfoHint
                  label="start from"
                  text={`Train the stock ${manifest.displayName} again from scratch, or keep training one of your own models on new clips. Continuing keeps what it already learned; settings it was built with (like its size) stay fixed.`}
                />
              </span>
              <select
                value={continueFrom}
                onChange={(e) => setContinueFrom(e.target.value)}
                className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">Stock {manifest.displayName}</option>
                <optgroup label="Keep training one of your models">
                  {trainedForModel.map((t) => (
                    <option key={t.id} value={t.id} disabled={!t.continue_info.resumable}>
                      {t.display_name}
                      {!t.continue_info.resumable && t.continue_info.reason ? ` — ${t.continue_info.reason}` : ""}
                    </option>
                  ))}
                </optgroup>
              </select>
              {continueSource && (
                <Callout tone="info">
                  Continues training {continueSource.display_name}
                  {continueSource.continue_info.totalSteps ? ` (at ${continueSource.continue_info.totalSteps.toLocaleString()} steps so far)` : ""}.
                  The training length below is added on top.
                  {Object.keys(locked).length > 0 && " Settings it was built with are locked."}
                </Callout>
              )}
            </label>
          )}

          <div className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5">
              Dataset ({isMidiDataset ? "MIDI files" : isCaptionedDataset ? "audio + captions" : "raw audio, no captions needed"})
              <InfoHint
                label="dataset"
                text={
                  isMidiDataset
                    ? "The MIDI songs the model learns from. Each file is split into segments and its musical attributes (instruments, tempo, key, time signature, length and more) are read automatically, so no labels are needed. Unreadable files are skipped and listed in the run log."
                    : isCaptionedDataset
                      ? "The audio clips the model learns from, each paired with a short text caption describing it. Captions teach the model what words map to which sounds, so it can follow your prompts afterward. Captions are optional — a blank one falls back to the filename."
                      : "The audio clips the model learns its sound from. This model only needs raw audio — no captions or labels. More (and longer) clips give a better-sounding result."
                }
              />
            </span>
            {isCaptionedDataset ? (
              <>
                <CaptionedDataset
                  durationOf={(f) => datasetCheck.probes.get(f)}
                  fileTypes={training.datasetRequirements.fileTypes}
                  minFiles={training.datasetRequirements.minFiles}
                  audioFiles={files}
                  onAudioFilesChange={setFiles}
                  captionMode={captionMode}
                  onCaptionModeChange={setCaptionMode}
                  typedCaptions={datasetCaptions}
                  onTypedCaptionsChange={setDatasetCaptions}
                  captionFiles={captionFiles}
                  onCaptionFilesChange={setCaptionFiles}
                  pairing={captionPairing}
                  onPairingChange={setCaptionPairing}
                />
                <DatasetSummary count={files.length} check={datasetCheck} />
              </>
            ) : (
              <>
                <DatasetDropZone
                  durationOf={(f) => datasetCheck.probes.get(f)}
                  fileTypes={training.datasetRequirements.fileTypes}
                  minFiles={training.datasetRequirements.minFiles}
                  files={files}
                  onFilesChange={setFiles}
                />
                <DatasetSummary count={files.length} check={datasetCheck} midi={isMidiDataset} />
              </>
            )}
          </div>

          {manifest.modelId === "musecoco" && <MusecocoGpuCard onBuilt={() => setMuseCocoGpuBuilt(true)} />}

          <div className="flex flex-col gap-3 border-t border-ink/10 pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Hyperparameters
              <InfoHint
                label="hyperparameters"
                text="The knobs that control how training runs. They don't change your dataset — they shape how long it trains, how fast it learns, and how much the result adapts to your clips. Hover the ⓘ next to each for details."
              />
            </p>
            {training.presets.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <SegmentedControl
                  ariaLabel="Training preset"
                  value={activePreset?.id ?? null}
                  onChange={(id) => {
                    const preset = training.presets.find((p) => p.id === id);
                    if (preset) setHyperparams((prev) => ({ ...prev, ...unlockedValues(preset.values) }));
                  }}
                  options={training.presets.map((p) => {
                    const est = estimateFor({ ...hyperparams, ...unlockedValues(p.values) });
                    return {
                      value: p.id,
                      label: (
                        <span>
                          {p.label}
                          {est !== null && <span className="ml-1.5 text-ink-muted">{formatEstimate(est)}</span>}
                        </span>
                      ),
                    };
                  })}
                />
                <p className="text-xs text-ink-muted">
                  {activePreset ? activePreset.description : "Custom settings."}
                  {currentEstimate !== null && ` About ${formatEstimate(currentEstimate).replace("~", "")} on an RTX 3090-class GPU.`}
                </p>
              </div>
            )}
            {training.hyperparameters.map((input) => {
              const hint = hintTextFor(input);
              return (
                <label key={input.key} className="flex flex-col gap-1.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    {input.label}
                    {hint && <InfoHint label={input.label} text={hint} />}
                  </span>
                  <FieldControl
                    input={input}
                    value={hyperparams[input.key]}
                    onChange={(v) => setHyperparams((prev) => ({ ...prev, [input.key]: v }))}
                    disabled={input.key in locked}
                  />
                </label>
              );
            })}
          </div>

          <HardwareGateBanner status={hardwareGate} />

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5">
              Save trained checkpoint to
              <InfoHint
                label="trained checkpoint location"
                text={
                  "Where the finished model file is written. When the run completes it's registered in the app automatically — it shows under Model Manager → My Trained Models and becomes selectable as a checkpoint in workspaces that use this model." +
                  (manifest.modelId === "ace-step-1.5"
                    ? "\n\nThis saves a LoRA adapter, not a full model: selecting it loads the base checkpoint it was trained on and applies the adapter on top."
                    : "")
                }
              />
            </span>
            <div className="flex gap-2">
              <input
                readOnly
                value={outputDir}
                className="kwesi-glass min-w-0 flex-1 rounded-[10px] px-3 py-2 text-xs outline-none"
              />
              <PillButton variant="ghost" size="sm" onClick={choosePickOutputDir}>
                Choose…
              </PillButton>
            </div>
            {disk && <Callout tone={disk.ok ? "info" : "error"}>{disk.message}</Callout>}
          </label>

          {submitError && <Callout tone="error">{submitError}</Callout>}

          <div className="flex items-center justify-end gap-2">
            <PillButton
              onClick={startRun}
              disabled={submitting || !runName.trim() || !meetsFileMinimum || hardwareGate.level === "block" || disk?.ok === false}
            >
              {submitting ? "Starting…" : "Start training run"}
            </PillButton>
          </div>

          {setupOpen && (
            <ModelSetupDialog
              modelId={manifest.modelId}
              purpose="train"
              variantName={baseVariant}
              onClose={() => setSetupOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  preprocess: "Preparing dataset",
  train: "Training",
  export: "Exporting",
  preview: "Making a preview clip",
};

function RunProgress({ run, live }: { run: TrainingRunRow; live: TrainingProgressEvent | undefined }) {
  if (run.status !== "running" && run.status !== "preparing") return null;
  const progress = live && live.type === "progress" ? live : null;
  const pct = progress?.pct;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-smooth"
          style={{ width: pct !== undefined ? `${pct}%` : "30%" }}
        />
      </div>
      {progress && progress.phase === "preview" ? (
        <div className="text-[11px] text-ink-muted">{PHASE_LABEL.preview}…</div>
      ) : progress && (
        <div className="text-[11px] text-ink-muted">
          {PHASE_LABEL[progress.phase] ?? progress.phase} · step {progress.step}
          {progress.maxSteps ? `/${progress.maxSteps}` : ""}
          {progress.rate ? ` · ${progress.rate.toFixed(1)} it/s` : ""}
          {progress.etaText ? ` · ETA ${progress.etaText}` : ""}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  live,
  hasPreview,
  continuedFrom,
  onCancel,
}: {
  run: TrainingRunRow;
  live: TrainingProgressEvent | undefined;
  hasPreview: boolean;
  continuedFrom?: string;
  onCancel: () => void;
}) {
  const manifest: ModelManifest | undefined = MANIFESTS[run.model_id];
  const hyperparams = useMemo(() => {
    try {
      return JSON.parse(run.hyperparams) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [run.hyperparams]);

  return (
    <InsetCard>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{run.run_name}</span>
            <span className="text-xs text-ink-muted">{manifest?.displayName ?? run.model_id}</span>
            <StatusBadge status={run.status} />
          </div>
          {continuedFrom && <p className="mt-0.5 text-xs text-ink-muted">Continued from {continuedFrom}</p>}
          {typeof hyperparams.max_steps === "number" && (
            <p className="mt-0.5 text-xs text-ink-muted">
              {hyperparams.max_steps} steps
              {typeof hyperparams.config === "string" ? ` · ${hyperparams.config}` : ""}
            </p>
          )}
          {(run.status === "failed" || run.status === "interrupted") && run.error && (
            <p className="mt-1 text-xs text-danger">{run.error}</p>
          )}
          {run.status === "completed" &&
            (run.output_checkpoint_id ? (
              run.output_dir && <p className="mt-1 truncate text-xs text-ink-muted">Saved to {run.output_dir}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">Trained model deleted</p>
            ))}
        </div>
        {(run.status === "running" || run.status === "preparing" || run.status === "queued") && (
          <PillButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </PillButton>
        )}
        {run.status === "completed" && hasPreview && run.output_checkpoint_id && (
          <PreviewButton trainedModelId={run.output_checkpoint_id} />
        )}
      </div>
      <RunProgress run={run} live={live} />
    </InsetCard>
  );
}

export function TrainingScreen() {
  const [runs, setRuns] = useState<TrainingRunRow[] | null>(null);
  const [liveByRun, setLiveByRun] = useState<Record<string, TrainingProgressEvent>>({});
  // trained_model ids whose run left a preview clip
  const [withPreview, setWithPreview] = useState<Set<string>>(new Set());
  // Bumped whenever trained models change (a run completed or one was deleted).
  const [trainedVersion, setTrainedVersion] = useState(0);
  // variant name -> run name, to show what a continued run started from
  const [nameByVariant, setNameByVariant] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(() => {
    kwesiTraining.list().then(setRuns);
    setTrainedVersion((v) => v + 1);
    kwesiTraining.listTrainedModels().then((tms) => {
      setWithPreview(new Set(tms.filter((t) => t.has_preview).map((t) => t.id)));
      setNameByVariant(new Map(tms.filter((t) => t.variant_name).map((t) => [t.variant_name!, t.display_name])));
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = kwesiTraining.onProgress((event) => {
      setLiveByRun((prev) => ("runId" in event ? { ...prev, [event.runId]: event } : prev));
      if (event.type === "status" || event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
        refresh();
      }
    });
    return unsubscribe;
  }, [refresh]);

  async function cancelRun(runId: string) {
    await kwesiTraining.cancel(runId);
    refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Training"
        subtitle="Drop in your own music and train a custom timbre model to use in a new workspace."
      />

      <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NewTrainingRunForm onSubmitted={refresh} trainedVersion={trainedVersion} />

          <div className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Training Runs</h2>
            {runs === null ? null : runs.length === 0 ? (
              <EmptyState icon={<TrainingIcon width={28} height={28} />} title="No training runs yet." />
            ) : (
              <div className="flex flex-col gap-2">
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    live={liveByRun[run.id]}
                    hasPreview={!!run.output_checkpoint_id && withPreview.has(run.output_checkpoint_id)}
                    continuedFrom={
                      run.base_checkpoint_variant
                        ? (nameByVariant.get(run.base_checkpoint_variant) ?? "a deleted model")
                        : undefined
                    }
                    onCancel={() => cancelRun(run.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
