import { useCallback, useEffect, useMemo, useState } from "react";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { kwesiDb, type ModelRow, type ModelVariantRow, type TrainedModelRow } from "../lib/db";
import { kwesiModels, type ModelsProgressEvent, type QueueRow } from "../lib/models";
import { kwesiTraining, type TrainingProgressEvent } from "../lib/training";
import { formatBytes } from "../lib/format";
import { openExternal } from "../lib/kwesiBridge";
import { getManifest, outputKindOf } from "../data/manifests";
import { GlassPanel } from "../components/ui/GlassPanel";
import { PillButton } from "../components/ui/PillButton";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ModelsIcon, ExternalLinkIcon, TrainingIcon, ChevronDownIcon, DownloadIcon } from "../components/ui/icons";

const OUTPUT_KIND_LABEL: Record<string, string> = {
  audio: "Audio",
  midi: "MIDI",
  "audio+midi": "Audio + MIDI",
};

const STATUS_LABEL: Record<string, string> = {
  not_installed: "Not installed",
  queued: "Queued",
  downloading: "Downloading",
  installed: "Installed",
  failed: "Failed",
};

function licenseLabel(tier: string): string {
  return (LICENSE_LABEL as Record<string, string>)[tier] ?? tier;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "installed"
      ? "bg-accent/10 text-accent"
      : status === "failed"
        ? "bg-red-500/10 text-red-600"
        : status === "downloading" || status === "queued"
          ? "bg-ink/[0.08] text-ink"
          : "bg-ink/[0.06] text-ink-muted";
  return (
    <span className={`shrink-0 rounded-chip px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ProgressBar({ variant }: { variant: ModelVariantRow }) {
  const total = variant.bytes_total;
  const done = variant.bytes_downloaded ?? 0;
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-smooth"
          style={{ width: pct !== null ? `${pct}%` : "35%" }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span className="truncate">{variant.current_file ?? "Preparing…"}</span>
        <span className="shrink-0">
          {pct !== null ? `${pct}% · ${formatBytes(done)} / ${formatBytes(total)}` : formatBytes(done)}
        </span>
      </div>
    </div>
  );
}

interface ModelAccordionRowProps {
  model: ModelRow;
  catalogEntry: (typeof CATALOG)[number] | undefined;
  variants: ModelVariantRow[];
  onInstall: (modelId: string, variant: ModelVariantRow) => void;
  onRetry: (modelId: string, variant: ModelVariantRow) => void;
  onCancel: (variant: ModelVariantRow) => void;
  onRequestRemove: (modelId: string, modelDisplayName: string, variant: ModelVariantRow) => void;
}

/**
 * One accordion section per catalog model — collapsed shows just the
 * identity (name, license/trainable badges, description, output kind);
 * expanded reveals its checkpoint variants as a smooth grid "table" rather
 * than the flat always-open list this used to be. Height animates via the
 * CSS grid-template-rows 0fr/1fr trick (no JS measuring, no library).
 */
function ModelAccordionRow({
  model,
  catalogEntry,
  variants,
  onInstall,
  onRetry,
  onCancel,
  onRequestRemove,
}: ModelAccordionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const manifest = getManifest(model.id);
  const outputLabel = manifest ? OUTPUT_KIND_LABEL[outputKindOf(manifest)] : null;
  const installedCount = variants.filter((v) => v.install_status === "installed").length;

  return (
    <div className="border-b border-ink/10 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-ink/[0.03]"
      >
        <ChevronDownIcon
          width={16}
          height={16}
          className={`shrink-0 text-ink-muted transition-transform duration-200 ease-smooth ${
            expanded ? "rotate-180" : ""
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{model.display_name}</span>
            <span className="rounded-chip bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              {licenseLabel(model.license_tier)}
            </span>
            {model.trainable === 1 && (
              <span className="rounded-chip bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                Trainable
              </span>
            )}
            {installedCount > 0 && (
              <span className="text-[11px] text-ink-muted">
                {installedCount} installed
              </span>
            )}
          </div>
          {catalogEntry && <p className="mt-0.5 truncate text-xs text-ink-muted">{catalogEntry.description}</p>}
        </div>
        {outputLabel && (
          <span className="shrink-0 rounded-chip bg-ink/[0.06] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            {outputLabel}
          </span>
        )}
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-smooth"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {variants.length === 0 ? (
            <p className="px-5 pb-4 text-xs text-ink-muted">No installable variants.</p>
          ) : (
            <div className="px-5 pb-4">
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-3 pb-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                <span>Variant</span>
                <span>Status</span>
                <span className="text-right">Size</span>
                <span className="text-right">Action</span>
              </div>
              <div className="rounded-[10px] bg-ink/[0.03]">
                {variants.map((variant, index) => (
                  <div key={variant.id}>
                    <div
                      className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-3 py-2.5 transition-colors duration-150 hover:bg-ink/[0.04] ${
                        index > 0 ? "border-t border-ink/[0.06]" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-sm">{variant.variant_name}</span>
                        {variant.source === "manual" && variant.manual_note && (
                          <p className="truncate text-xs text-ink-muted">{variant.manual_note}</p>
                        )}
                        {variant.error && variant.install_status === "failed" && (
                          <p className="truncate text-xs text-red-600">{variant.error}</p>
                        )}
                      </div>
                      <StatusBadge status={variant.install_status} />
                      <span className="text-right text-xs text-ink-muted">{formatBytes(variant.disk_size_bytes)}</span>
                      <div className="flex justify-end">
                        {variant.source === "manual" && variant.install_status !== "installed" ? (
                          <button
                            type="button"
                            onClick={() => variant.manual_url && openExternal(variant.manual_url)}
                            title="Open the real download location"
                            aria-label="Open the real download location"
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-muted transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink"
                          >
                            <ExternalLinkIcon width={16} height={16} />
                          </button>
                        ) : variant.install_status === "installed" ? (
                          <PillButton
                            variant="ghost"
                            className="!px-3 !py-1.5 text-xs"
                            onClick={() => onRequestRemove(model.id, model.display_name, variant)}
                          >
                            Remove
                          </PillButton>
                        ) : variant.install_status === "downloading" || variant.install_status === "queued" ? (
                          <PillButton
                            variant="ghost"
                            className="!px-3 !py-1.5 text-xs"
                            onClick={() => onCancel(variant)}
                          >
                            Cancel
                          </PillButton>
                        ) : variant.install_status === "failed" ? (
                          <PillButton className="!px-3 !py-1.5 text-xs" onClick={() => onRetry(model.id, variant)}>
                            Retry
                          </PillButton>
                        ) : (
                          <PillButton className="!px-3 !py-1.5 text-xs" onClick={() => onInstall(model.id, variant)}>
                            <DownloadIcon width={14} height={14} /> Download
                          </PillButton>
                        )}
                      </div>
                    </div>
                    {(variant.install_status === "downloading" || variant.install_status === "queued") && (
                      <div className="px-3 pb-2.5">
                        <ProgressBar variant={variant} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RemoveTarget {
  modelId: string;
  modelDisplayName: string;
  variantName: string;
  diskSizeBytes: number | null;
  workspaces: { id: string; name: string }[];
}

export function ModelManagerScreen() {
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [variantsByModel, setVariantsByModel] = useState<Record<string, ModelVariantRow[]>>({});
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [diskFree, setDiskFree] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [trainedModels, setTrainedModels] = useState<TrainedModelRow[]>([]);

  const refreshTrainedModels = useCallback(() => {
    kwesiTraining.listTrainedModels().then(setTrainedModels);
  }, []);

  const refreshQueue = useCallback(() => {
    kwesiModels.listQueue().then(setQueue);
  }, []);

  const refreshVariants = useCallback(async (modelId: string) => {
    const rows = await kwesiDb.listModelVariants(modelId);
    setVariantsByModel((prev) => ({ ...prev, [modelId]: rows }));
  }, []);

  useEffect(() => {
    kwesiDb.listModels().then(async (rows) => {
      setModels(rows);
      await Promise.all(rows.map((m) => refreshVariants(m.id)));
    });
    refreshQueue();
    kwesiModels.diskFreeBytes().then(setDiskFree);
    refreshTrainedModels();
  }, [refreshVariants, refreshQueue, refreshTrainedModels]);

  // Phase 10: a completed training run registers its checkpoint live —
  // refresh "My Trained Models" (and this model's variant list, since the
  // trained checkpoint also lands as an installed model_variant row) the
  // moment one lands, rather than only on next screen visit.
  useEffect(() => {
    const unsubscribe = kwesiTraining.onProgress((event: TrainingProgressEvent) => {
      if (event.type !== "completed") return;
      refreshTrainedModels();
    });
    return unsubscribe;
  }, [refreshTrainedModels]);

  useEffect(() => {
    const unsubscribe = kwesiModels.onProgress((event: ModelsProgressEvent) => {
      setVariantsByModel((prev) => {
        const list = prev[event.modelId];
        if (!list) return prev;
        const next = list.map((v) => {
          if (v.id !== event.variantId) return v;
          switch (event.type) {
            case "status":
              return { ...v, install_status: event.status, error: null };
            case "progress":
              return {
                ...v,
                install_status: "downloading",
                bytes_downloaded: event.bytesDownloaded,
                bytes_total: event.bytesTotal,
                current_file: event.currentFile,
              };
            case "installed":
              return {
                ...v,
                install_status: "installed",
                install_path: event.installPath,
                disk_size_bytes: event.diskSizeBytes,
                bytes_downloaded: null,
                bytes_total: null,
                current_file: null,
                error: null,
              };
            case "failed":
              return {
                ...v,
                install_status: "failed",
                error: event.error,
                bytes_downloaded: null,
                bytes_total: null,
                current_file: null,
              };
            case "cancelled":
              return {
                ...v,
                install_status: "not_installed",
                bytes_downloaded: null,
                bytes_total: null,
                current_file: null,
                error: null,
              };
            default:
              return v;
          }
        });
        return { ...prev, [event.modelId]: next };
      });
      refreshQueue();
    });
    return unsubscribe;
  }, [refreshQueue]);

  function setVariantError(modelId: string, variantId: string, error: string) {
    setVariantsByModel((prev) => ({
      ...prev,
      [modelId]: prev[modelId]?.map((v) => (v.id === variantId ? { ...v, error } : v)) ?? [],
    }));
  }

  async function handleInstall(modelId: string, variant: ModelVariantRow) {
    const res = await kwesiModels.install(modelId, variant.variant_name);
    if (!res.ok) setVariantError(modelId, variant.id, res.reason ?? "Could not start install");
  }

  async function handleRetry(modelId: string, variant: ModelVariantRow) {
    const res = await kwesiModels.retry(modelId, variant.variant_name);
    if (!res.ok) setVariantError(modelId, variant.id, res.reason ?? "Could not retry install");
  }

  async function handleCancel(variant: ModelVariantRow) {
    await kwesiModels.cancel(variant.id);
    refreshQueue();
  }

  async function requestRemove(modelId: string, modelDisplayName: string, variant: ModelVariantRow) {
    const workspaces = await kwesiModels.workspacesUsingModel(modelId);
    setRemoveTarget({
      modelId,
      modelDisplayName,
      variantName: variant.variant_name,
      diskSizeBytes: variant.disk_size_bytes,
      workspaces,
    });
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    await kwesiModels.remove(removeTarget.modelId, removeTarget.variantName);
    await refreshVariants(removeTarget.modelId);
    setRemoveTarget(null);
    refreshQueue();
  }

  const catalogById = useMemo(() => new Map(CATALOG.map((c) => [c.modelId, c])), []);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Model Manager</h1>
          <p className="text-sm text-ink-muted">
            Download and manage checkpoints, streamed straight from Hugging Face.
          </p>
        </div>
        {diskFree !== null && (
          <div className="shrink-0 pt-1 text-right text-xs text-ink-muted">{formatBytes(diskFree)} free</div>
        )}
      </div>

      <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-ink/10 p-5">
        <h2 className="mb-3 text-sm font-semibold">Install Queue</h2>
        {queue.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing downloading right now.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((row) => (
              <div key={row.id} className="rounded-[10px] bg-ink/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {row.model_display_name} · {row.variant_name}
                    </div>
                    {row.install_status === "failed" && row.error && (
                      <p className="truncate text-xs text-red-600">{row.error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={row.install_status} />
                    {row.install_status === "failed" ? (
                      <PillButton
                        variant="ghost"
                        className="!px-3 !py-1 text-xs"
                        onClick={() => handleRetry(row.model_id, row)}
                      >
                        Retry
                      </PillButton>
                    ) : (
                      <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={() => handleCancel(row)}>
                        Cancel
                      </PillButton>
                    )}
                  </div>
                </div>
                {(row.install_status === "downloading" || row.install_status === "queued") && (
                  <ProgressBar variant={row} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {models === null ? null : models.length === 0 ? (
        <div className="border-b border-ink/10 p-5">
          <EmptyState icon={<ModelsIcon width={28} height={28} />} title="No models in the catalog." />
        </div>
      ) : (
        <div className="flex flex-col">
          {models.map((model) => (
            <ModelAccordionRow
              key={model.id}
              model={model}
              catalogEntry={catalogById.get(model.id)}
              variants={variantsByModel[model.id] ?? []}
              onInstall={handleInstall}
              onRetry={handleRetry}
              onCancel={handleCancel}
              onRequestRemove={requestRemove}
            />
          ))}
        </div>
      )}

      <div className="p-5">
        <h2 className="mb-3 text-sm font-semibold">My Trained Models</h2>
        {trainedModels.length === 0 ? (
          <EmptyState
            icon={<TrainingIcon width={24} height={24} />}
            title="No trained checkpoints yet — start a run from the Training screen."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {trainedModels.map((tm) => {
              const model = models?.find((m) => m.id === tm.base_model_id);
              return (
                <div key={tm.id} className="rounded-[10px] bg-ink/[0.03] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm">{tm.display_name}</span>
                    <span className="rounded-chip bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                      {model?.display_name ?? tm.base_model_id}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-muted">{tm.checkpoint_path}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      </GlassPanel>

      {removeTarget && (
        <ConfirmDialog
          title={`Remove ${removeTarget.variantName}?`}
          description={
            <div className="flex flex-col gap-2">
              <p>
                This deletes the downloaded weights for this variant from disk
                {removeTarget.diskSizeBytes ? ` (${formatBytes(removeTarget.diskSizeBytes)})` : ""}.
              </p>
              {removeTarget.workspaces.length > 0 && (
                <p>
                  {removeTarget.workspaces.length === 1 ? "A workspace is" : "These workspaces are"} bound to{" "}
                  {removeTarget.modelDisplayName}: {removeTarget.workspaces.map((w) => w.name).join(", ")}. They'll
                  still work fine with any other installed variant of this model.
                </p>
              )}
            </div>
          }
          confirmLabel="Remove"
          onCancel={() => setRemoveTarget(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  );
}
