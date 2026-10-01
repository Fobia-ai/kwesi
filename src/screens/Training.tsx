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
import { kwesiTraining, type TrainingProgressEvent } from "../lib/training";
import { kwesiEnvironment, type EnvStatus } from "../lib/environment";
import { Modal } from "../components/ui/Modal";
import type { TrainingRunRow } from "../lib/db";

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
  const tone =
    status === "completed"
      ? "bg-accent/10 text-accent"
      : status === "failed" || status === "interrupted"
        ? "bg-red-500/10 text-red-600"
        : status === "cancelled"
          ? "bg-ink/[0.06] text-ink-muted"
          : "bg-ink/[0.08] text-ink";
  return (
    <span className={`shrink-0 rounded-chip px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
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
}: {
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
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-chip bg-ink/[0.06] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onCaptionModeChange("files")}
            className={`rounded-chip px-2.5 py-1 transition-colors ${captionMode === "files" ? "bg-bg text-ink shadow-glass-sm" : "text-ink-muted"}`}
          >
            From files
          </button>
          <button
            type="button"
            onClick={() => onCaptionModeChange("text")}
            className={`rounded-chip px-2.5 py-1 transition-colors ${captionMode === "text" ? "bg-bg text-ink shadow-glass-sm" : "text-ink-muted"}`}
          >
            Type manually
          </button>
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
      {importError && <p className="text-xs text-red-600">{importError}</p>}

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
                <span className="w-2/5 shrink-0 truncate text-xs" title={f.name}>
                  {f.name}
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
                      <span className="shrink-0 text-xs text-accent" title="Matched">
                        ✓
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-amber-600" title="No caption file — falls back to the filename">
                        ⚠
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
                  className="w-6 shrink-0 text-center text-ink-muted hover:text-red-600"
                  onClick={() => removeAudio(i)}
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
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

/**
 * Phase 11: directory-input dataset picker, used only by models whose
 * `training.datasetRequirements.fileTypes` is empty — signals a directory
 * input rather than individual files (currently only MuseCoco's real
 * fairseq data-bin directory — see trainingManager.ts's
 * runMuseCocoTrainingPipeline's honest scope-cut comment for why raw MIDI
 * upload isn't wired yet).
 */
function DatasetDirPicker({ path, onPathChange }: { path: string; onPathChange: (path: string) => void }) {
  async function choose() {
    const result = await kwesiTraining.pickDatasetDir();
    if (result.ok && result.path) onPathChange(result.path);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          readOnly
          value={path}
          placeholder="No dataset directory chosen"
          className="kwesi-glass min-w-0 flex-1 rounded-[10px] px-3 py-2 text-xs outline-none"
        />
        <PillButton variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={choose}>
          Choose…
        </PillButton>
      </div>
      <p className="text-xs text-ink-muted">
        A pre-binarized fairseq data-bin directory (dict.txt + .bin/.idx files) — raw-MIDI dataset prep isn't wired
        up yet, see kwesi.docs/04-roadmap.md Phase 11.
      </p>
    </div>
  );
}

function DatasetDropZone({
  fileTypes,
  minFiles,
  files,
  onFilesChange,
}: {
  fileTypes: string[];
  minFiles: number;
  files: File[];
  onFilesChange: (files: File[]) => void;
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
        <span>Drop or choose audio files ({fileTypes.join(", ")})</span>
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
      {error && <p className="text-xs text-red-600">{error}</p>}
      {files.length > 0 && (
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-[10px] bg-ink/[0.03] p-2 text-xs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="shrink-0 text-ink-muted hover:text-red-600"
                onClick={() => onFilesChange(files.filter((_, idx) => idx !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Shown when a run is attempted before the model's TRAINING environment is
 * installed (RAVE trains in a separate `rave-train` venv; the others train in
 * their inference venv). Reuses the same real install flow + progress stream
 * as Settings > Environment, so this is a shortcut to that action, not a
 * lesser one.
 */
function TrainingSetupDialog({
  modelId,
  displayName,
  onClose,
}: {
  modelId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setStatus(await kwesiEnvironment.checkTrainingStatus(modelId));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(
    () =>
      kwesiEnvironment.onProgress((event) => {
        if (event.modelId !== modelId) return;
        setLog((prev) => [...prev.slice(-29), event.line]);
      }),
    [modelId],
  );

  async function install() {
    setMessage(null);
    setLog([]);
    setInstalling(true);
    const result = await kwesiEnvironment.installTraining(modelId);
    setInstalling(false);
    if (!result.ok) setMessage(result.reason ?? "Install failed.");
    await refresh();
  }

  const ready = status?.venvExists ?? false;

  return (
    <Modal title={`Set up ${displayName} training`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-ink-muted">
          Training {displayName} needs its training environment installed first — this is a one-time setup (real Python
          packages, may take several minutes).
        </p>

        <div className="rounded-[12px] bg-ink/[0.03] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Training environment</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {ready ? "Ready" : installing ? "Installing…" : "Not installed"}
              </p>
            </div>
            {!ready && (
              <PillButton className="!px-3 !py-1.5 text-xs" onClick={install} disabled={installing}>
                {installing ? "Installing…" : "Set up"}
              </PillButton>
            )}
          </div>
          {log.length > 0 && (
            <pre className="kwesi-scroll-inset mt-2 max-h-28 overflow-y-auto rounded-[8px] bg-ink/[0.05] p-2 font-mono text-[10px] leading-relaxed text-ink-muted">
              {log.join("\n")}
            </pre>
          )}
          {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
        </div>

        <div className="flex justify-end">
          <PillButton onClick={onClose} variant={ready ? "accent" : "ghost"}>
            {ready ? "Done — start the run" : "Close"}
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}

function NewTrainingRunForm({ onSubmitted }: { onSubmitted: () => void }) {
  const trainableModels = useMemo(() => Object.values(MANIFESTS), []);
  const [modelId, setModelId] = useState<string>("");
  const [runName, setRunName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [datasetCaptions, setDatasetCaptions] = useState<Record<string, string>>({});
  const [captionMode, setCaptionMode] = useState<"files" | "text">("files");
  const [captionFiles, setCaptionFiles] = useState<File[]>([]);
  const [captionPairing, setCaptionPairing] = useState<Record<string, string>>({});
  const [datasetDirPath, setDatasetDirPath] = useState<string>("");
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
    setDatasetDirPath("");
  }

  useEffect(() => {
    kwesiHardware.gpuVram().then(setGpu);
  }, []);

  const manifest = modelId ? MANIFESTS[modelId] : undefined;
  const training =
    manifest && manifest.training.supported ? (manifest.training as TrainingSupportedConfig) : undefined;
  // Phase 11: a model whose dataset input is a whole directory (currently
  // only MuseCoco's fairseq data-bin) rather than individual files signals
  // that with an empty fileTypes list — see DatasetDirPicker's own comment.
  const isDirectoryDataset = training ? training.datasetRequirements.fileTypes.length === 0 : false;
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
  const meetsFileMinimum = training
    ? isDirectoryDataset
      ? datasetDirPath.length > 0
      : files.length >= training.datasetRequirements.minFiles
    : false;

  // Gate on the training environment before submitting (a model trains in a
  // venv that may differ from its inference one -- RAVE in `rave-train`).
  // Without this the run starts, then fails deep in the pipeline with a raw
  // "venv not found" -- same late-failure UX the generation gate fixed.
  async function startRun() {
    if (!training || !manifest) return;
    const env = await kwesiEnvironment.checkTrainingStatus(manifest.modelId);
    if (!env.venvExists) {
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
      const datasetFiles = isDirectoryDataset
        ? [datasetDirPath]
        : files.map(resolveUploadedFilePath).filter((p) => p.length > 0);
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

          <div className="flex flex-col gap-1.5 text-sm">
            Dataset ({isDirectoryDataset ? "pre-processed directory" : isCaptionedDataset ? "audio + captions" : "raw audio, no captions needed"})
            {isDirectoryDataset ? (
              <DatasetDirPicker path={datasetDirPath} onPathChange={setDatasetDirPath} />
            ) : isCaptionedDataset ? (
              <>
                <CaptionedDataset
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
                {!meetsFileMinimum && files.length > 0 && (
                  <p className="text-xs text-amber-600">
                    Needs at least {training.datasetRequirements.minFiles} audio files (have {files.length}).
                  </p>
                )}
              </>
            ) : (
              <>
                <DatasetDropZone
                  fileTypes={training.datasetRequirements.fileTypes}
                  minFiles={training.datasetRequirements.minFiles}
                  files={files}
                  onFilesChange={setFiles}
                />
                {!meetsFileMinimum && files.length > 0 && (
                  <p className="text-xs text-amber-600">
                    Needs at least {training.datasetRequirements.minFiles} files (have {files.length}).
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-ink/10 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Hyperparameters</p>
            {training.hyperparameters.map((input) => (
              <label key={input.key} className="flex flex-col gap-1.5 text-sm">
                {input.label}
                <FieldControl
                  input={input}
                  value={hyperparams[input.key]}
                  onChange={(v) => setHyperparams((prev) => ({ ...prev, [input.key]: v }))}
                />
                {input.helpText && <span className="text-xs text-ink-muted">{input.helpText}</span>}
              </label>
            ))}
          </div>

          <HardwareGateBanner status={hardwareGate} />

          <label className="flex flex-col gap-1.5 text-sm">
            Save trained checkpoint to
            <div className="flex gap-2">
              <input
                readOnly
                value={outputDir}
                className="kwesi-glass min-w-0 flex-1 rounded-[10px] px-3 py-2 text-xs outline-none"
              />
              <PillButton variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={choosePickOutputDir}>
                Choose…
              </PillButton>
            </div>
          </label>

          {submitError && <p className="text-xs text-red-600">{submitError}</p>}

          <div className="flex items-center justify-end gap-2">
            <PillButton
              onClick={startRun}
              disabled={submitting || !runName.trim() || !meetsFileMinimum || hardwareGate.level === "block"}
            >
              {submitting ? "Starting…" : "Start training run"}
            </PillButton>
          </div>

          {setupOpen && (
            <TrainingSetupDialog
              modelId={manifest.modelId}
              displayName={manifest.displayName}
              onClose={() => setSetupOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

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
      {progress && (
        <div className="text-[11px] text-ink-muted">
          {progress.phase} · step {progress.step}
          {progress.maxSteps ? `/${progress.maxSteps}` : ""}
          {progress.rate ? ` · ${progress.rate.toFixed(1)} it/s` : ""}
          {progress.etaText ? ` · ETA ${progress.etaText}` : ""}
        </div>
      )}
    </div>
  );
}

function RunRow({ run, live, onCancel }: { run: TrainingRunRow; live: TrainingProgressEvent | undefined; onCancel: () => void }) {
  const manifest: ModelManifest | undefined = MANIFESTS[run.model_id];
  const hyperparams = useMemo(() => {
    try {
      return JSON.parse(run.hyperparams) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [run.hyperparams]);

  return (
    <div className="rounded-[10px] bg-ink/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{run.run_name}</span>
            <span className="text-xs text-ink-muted">{manifest?.displayName ?? run.model_id}</span>
            <StatusBadge status={run.status} />
          </div>
          {typeof hyperparams.max_steps === "number" && (
            <p className="mt-0.5 text-xs text-ink-muted">
              {hyperparams.max_steps} steps
              {typeof hyperparams.config === "string" ? ` · ${hyperparams.config}` : ""}
            </p>
          )}
          {(run.status === "failed" || run.status === "interrupted") && run.error && (
            <p className="mt-1 text-xs text-red-600">{run.error}</p>
          )}
          {run.status === "completed" && run.output_dir && (
            <p className="mt-1 truncate text-xs text-ink-muted">Saved to {run.output_dir}</p>
          )}
        </div>
        {(run.status === "running" || run.status === "preparing" || run.status === "queued") && (
          <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={onCancel}>
            Cancel
          </PillButton>
        )}
      </div>
      <RunProgress run={run} live={live} />
    </div>
  );
}

export function TrainingScreen() {
  const [runs, setRuns] = useState<TrainingRunRow[] | null>(null);
  const [liveByRun, setLiveByRun] = useState<Record<string, TrainingProgressEvent>>({});

  const refresh = useCallback(() => {
    kwesiTraining.list().then(setRuns);
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
          <NewTrainingRunForm onSubmitted={refresh} />

          <div className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Training Runs</h2>
            {runs === null ? null : runs.length === 0 ? (
              <EmptyState icon={<TrainingIcon width={28} height={28} />} title="No training runs yet." />
            ) : (
              <div className="flex flex-col gap-2">
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} live={liveByRun[run.id]} onCancel={() => cancelRun(run.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
