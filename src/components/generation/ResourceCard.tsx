import { useEffect, useState } from "react";
import { getManifest, minVramGbFor, type ModelManifest } from "../../data/manifests";
import { kwesiGeneration, type ServerStatusValue } from "../../lib/generation";
import { useSystemResources, type SystemResources } from "../../lib/hardware";
import { assessResources, formatGb, type ResourceVerdict } from "../../lib/resourceCheck";
import { AlertIcon, CheckCircleIcon } from "../ui/icons";

/**
 * Whether this machine can run a checkpoint, shown with the numbers behind
 * the answer: GPU and system memory, and whether the model is loaded yet.
 * Used twice -- in the new-track form before Generate, and on a track while
 * it's queued and its model loads.
 */

/** The model server's live status: asked once, then kept current by events. */
function useServerStatus(modelId: string): ServerStatusValue | null {
  const [status, setStatus] = useState<ServerStatusValue | null>(null);
  useEffect(() => {
    let stale = false;
    setStatus(null);
    const unsubscribe = kwesiGeneration.onProgress((event) => {
      if (event.type !== "server_status" || event.modelId !== modelId) return;
      stale = true;
      setStatus(event.status);
    });
    kwesiGeneration.serverStatus(modelId).then((snapshot) => {
      if (!stale) setStatus(snapshot);
    });
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [modelId]);
  return status;
}

export interface ResourceCheck {
  resources: SystemResources | null;
  serverStatus: ServerStatusValue | null;
  requiredVramGb: number;
  verdict: ResourceVerdict;
}

/** Live resources and model status for one checkpoint, with the verdict. */
export function useResourceCheck(
  manifest: ModelManifest,
  variant: string | null,
  intervalMs?: number,
  generating = false,
): ResourceCheck {
  const resources = useSystemResources(intervalMs);
  const serverStatus = useServerStatus(manifest.modelId);
  const requiredVramGb = minVramGbFor(manifest, variant);
  const verdict = assessResources({
    displayName: manifest.displayName,
    cpuFallback: manifest.hardware.cpuFallback,
    requiredVramGb,
    resources,
    modelLoaded: serverStatus === "running",
    generating,
    otherLoadedModels: (resources?.loadedModelIds ?? [])
      .filter((id) => id !== manifest.modelId)
      .map((id) => getManifest(id)?.displayName ?? id),
  });
  return { resources, serverStatus, requiredVramGb, verdict };
}

function Meter({
  label,
  caption,
  value,
  usedPct,
  neededPct = 0,
  neededFits = true,
}: {
  label: string;
  caption?: string;
  value: string;
  usedPct: number;
  neededPct?: number;
  neededFits?: boolean;
}) {
  const used = Math.min(100, Math.max(0, usedPct));
  const needed = Math.min(100 - used, Math.max(0, neededPct));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium text-ink">{label}</span>
          {caption && <span className="ml-1.5 text-ink-muted">{caption}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-ink-muted">{value}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.08]">
        <div className="h-full bg-ink/55 transition-[width] duration-500 ease-smooth" style={{ width: `${used}%` }} />
        {needed > 0 && (
          <div
            className={`h-full transition-[width] duration-500 ease-smooth ${neededFits ? "bg-success/60" : "bg-warning/70"}`}
            style={{ width: `${needed}%` }}
          />
        )}
      </div>
    </div>
  );
}

export type ResourcePhase = "preflight" | "queued" | "running";

function modelStatusLine(phase: ResourcePhase, serverStatus: ServerStatusValue | null): { text: string; busy: boolean; done: boolean } {
  if (phase === "running") return { text: "Loaded — generating now", busy: true, done: true };
  switch (serverStatus) {
    case "running":
      return { text: phase === "queued" ? "Loaded — starting generation" : "Loaded and ready", busy: phase === "queued", done: true };
    case "starting":
      return { text: "Loading into memory…", busy: true, done: false };
    case "stopping":
      return { text: "Unloading…", busy: true, done: false };
    case "stopped":
      return {
        text: phase === "queued" ? "Waiting to load" : "Not loaded yet — it loads when you generate, so the first track takes longer",
        busy: phase === "queued",
        done: false,
      };
    default:
      return { text: "Checking…", busy: false, done: false };
  }
}

export function ResourceCard({
  check,
  phase = "preflight",
  progress,
  dense = false,
  className = "",
}: {
  check: ResourceCheck;
  phase?: ResourcePhase;
  // On a track that's queued or generating, the card is also its progress
  // surface: a compact layout with the progress bar and Stop built in.
  progress?: { pct: number; onCancel?: () => void };
  // Shorter meter text for a narrow column (the hero's side slot).
  dense?: boolean;
  className?: string;
}) {
  const { resources, serverStatus, requiredVramGb, verdict } = check;
  const tone =
    verdict.level === "block" ? "text-danger" : verdict.level === "warn" ? "text-warning" : verdict.level === "ok" ? "text-success" : "text-ink-muted";
  const Icon = verdict.level === "ok" ? CheckCircleIcon : AlertIcon;
  const model = modelStatusLine(phase, serverStatus);
  const gpu = resources?.gpu;
  const compact = progress !== undefined;
  // Once the model is in memory its share is already inside "used".
  const showNeeded = !!gpu?.available && requiredVramGb > 0 && serverStatus !== "running" && phase !== "running";
  const problem = verdict.level === "warn" || verdict.level === "block";

  const meters = resources && (
    <div className={compact ? "grid grid-cols-2 gap-x-5 gap-y-2" : "flex flex-col gap-2.5"}>
      {gpu?.available ? (
        <Meter
          label="GPU memory"
          caption={compact || dense ? undefined : gpu.name}
          value={
            compact || dense
              ? `${formatGb(gpu.usedVramGb)} of ${formatGb(gpu.totalVramGb)}`
              : `${formatGb(gpu.usedVramGb)} of ${formatGb(gpu.totalVramGb)} used${showNeeded ? ` · needs ${formatGb(requiredVramGb)}` : ""}`
          }
          usedPct={(gpu.usedVramGb / gpu.totalVramGb) * 100}
          neededPct={showNeeded ? (requiredVramGb / gpu.totalVramGb) * 100 : 0}
          neededFits={gpu.freeVramGb >= requiredVramGb}
        />
      ) : (
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-medium text-ink">GPU memory</span>
          <span className="text-ink-muted">{compact ? "No GPU" : "No NVIDIA GPU detected"}</span>
        </div>
      )}
      <Meter
        label="System memory"
        value={`${formatGb(resources.ram.totalGb - resources.ram.freeGb)} of ${formatGb(resources.ram.totalGb)}${compact || dense ? "" : " used"}`}
        usedPct={((resources.ram.totalGb - resources.ram.freeGb) / resources.ram.totalGb) * 100}
      />
    </div>
  );

  const modelDot = (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.done ? "bg-success" : "bg-ink/30"} ${model.busy ? "animate-pulse" : ""}`}
      aria-hidden
    />
  );

  if (compact) {
    return (
      <section
        aria-label="Resources for this track"
        className={`flex flex-col gap-2.5 rounded-[14px] border border-ink/[0.07] bg-white/70 px-3.5 py-3 ${className}`}
      >
        <div className="flex items-center gap-2" role={problem ? "alert" : "status"}>
          {verdict.level === "checking" ? (
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ink/30" aria-hidden />
          ) : (
            <Icon width={15} height={15} className={`shrink-0 ${tone}`} />
          )}
          <p
            className={`min-w-0 flex-1 truncate text-xs font-medium ${verdict.level === "checking" ? "text-ink-muted" : tone}`}
            title={verdict.detail}
          >
            {verdict.headline}
          </p>
          {progress.onCancel && (
            <button
              type="button"
              onClick={progress.onCancel}
              className="shrink-0 rounded-chip px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors duration-150 hover:bg-danger/10 hover:text-danger"
            >
              Stop
            </button>
          )}
        </div>
        {/* Only a problem needs explaining; when it's fine the headline says it all. */}
        {problem && verdict.detail && <p className="-mt-1 text-xs leading-relaxed text-ink-muted">{verdict.detail}</p>}
        {meters}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs">
            {modelDot}
            <span className="min-w-0 flex-1 truncate text-ink-muted">{model.text}</span>
            {phase === "running" && <span className="shrink-0 tabular-nums text-ink-muted">{Math.round(progress.pct)}%</span>}
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]"
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === "running" ? Math.round(progress.pct) : 0}
          >
            <div
              className={`h-full rounded-full bg-accent transition-all duration-300 ease-smooth ${phase === "queued" ? "animate-pulse" : ""}`}
              style={{ width: `${phase === "queued" ? 4 : Math.max(4, progress.pct)}%` }}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Resources for this track"
      className={`flex flex-col gap-3 rounded-[12px] border border-ink/[0.07] bg-ink/[0.03] px-3.5 py-3 ${className}`}
    >
      <div className="flex items-start gap-2" role={problem ? "alert" : "status"}>
        {verdict.level === "checking" ? (
          <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ink/30" aria-hidden />
        ) : (
          <Icon width={16} height={16} className={`mt-[1px] shrink-0 ${tone}`} />
        )}
        <div className="min-w-0">
          <p className={`text-sm font-medium ${verdict.level === "checking" ? "text-ink-muted" : tone}`}>{verdict.headline}</p>
          {verdict.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{verdict.detail}</p>}
        </div>
      </div>

      {meters}

      <div className="flex items-center gap-2 border-t border-ink/[0.07] pt-2.5 text-xs">
        <span className="shrink-0 font-medium text-ink">Model</span>
        {modelDot}
        <span className="min-w-0 text-ink-muted">{model.text}</span>
      </div>
    </section>
  );
}
