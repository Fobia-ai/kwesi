import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassPanel } from "../components/ui/GlassPanel";
import { PillButton } from "../components/ui/PillButton";
import { EmptyState } from "../components/ui/EmptyState";
import { TrainingIcon } from "../components/ui/icons";
import { MANIFESTS, type ModelManifest, type TrainingSupportedConfig } from "../data/manifests";
import {
  FieldControl,
  defaultValueFor,
  isSatisfied,
  evaluateHardwareGate,
  HardwareGateBanner,
  type GenerationFormValues,
} from "../components/generation/DynamicGenerationForm";
import { kwesiHardware, type GpuVramInfo } from "../lib/hardware";
import { kwesiTraining, type TrainingProgressEvent } from "../lib/training";
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

function NewTrainingRunForm({ onSubmitted }: { onSubmitted: () => void }) {
  const trainableModels = useMemo(() => Object.values(MANIFESTS), []);
  const [modelId, setModelId] = useState<string>("");
  const [runName, setRunName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [hyperparams, setHyperparams] = useState<GenerationFormValues>({});
  const [outputDir, setOutputDir] = useState<string>("");
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    kwesiHardware.gpuVram().then(setGpu);
  }, []);

  const manifest = modelId ? MANIFESTS[modelId] : undefined;
  const training =
    manifest && manifest.training.supported ? (manifest.training as TrainingSupportedConfig) : undefined;

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

  const missingHyperparams = training
    ? training.hyperparameters.some((input) => !isSatisfied(input, hyperparams[input.key]))
    : false;
  const hardwareGate = training ? evaluateHardwareGate(manifest!, training.hardware.minVramGb, gpu) : { level: "ok" as const };
  const meetsFileMinimum = training ? files.length >= training.datasetRequirements.minFiles : false;

  const canSubmit =
    !!training && !!runName.trim() && meetsFileMinimum && !missingHyperparams && hardwareGate.level !== "block" && !submitting;

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
      });
      if (!result.ok) {
        setSubmitError(result.reason ?? "Could not start this training run.");
        return;
      }
      setFiles([]);
      setRunName("");
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GlassPanel className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">New Training Run</h2>

      <label className="flex flex-col gap-1.5 text-sm">
        Base model
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            setFiles([]);
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
            Dataset ({training.datasetRequirements.requiresCaptions ? "audio + captions" : "raw audio, no captions needed"})
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

          <div className="flex justify-end">
            <PillButton disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? "Starting…" : "Start Training Run"}
            </PillButton>
          </div>
        </>
      )}
    </GlassPanel>
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
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto pb-8">
      <div>
        <h1 className="text-xl font-semibold">Training</h1>
        <p className="text-sm text-ink-muted">
          Drop in your own music, train a custom timbre model, and use it in a new workspace. RAVE is the pilot
          model for this pipeline — see kwesi.docs/04-roadmap.md Phase 10.
        </p>
      </div>

      <NewTrainingRunForm onSubmitted={refresh} />

      <GlassPanel className="p-4">
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
      </GlassPanel>
    </div>
  );
}
