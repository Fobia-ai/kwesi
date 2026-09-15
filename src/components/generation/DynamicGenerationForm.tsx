import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { minVramGbFor, type ManifestInput, type ModelManifest } from "../../data/manifests";
import { kwesiHardware, type GpuVramInfo } from "../../lib/hardware";
import { PillButton } from "../ui/PillButton";
import { EmptyState } from "../ui/EmptyState";
import { ModelsIcon } from "../ui/icons";

export type GenerationFormValues = Record<string, unknown>;

interface DynamicGenerationFormProps {
  manifest: ModelManifest;
  installedVariantNames: string[];
  disabled?: boolean;
  onSubmit: (checkpointVariant: string | null, values: GenerationFormValues) => void;
}

function visibleInputs(inputs: ManifestInput[], selectedVariant: string | null): ManifestInput[] {
  return inputs.filter((input) => !input.onlyForVariant || input.onlyForVariant === selectedVariant);
}

function defaultValueFor(input: ManifestInput): unknown {
  if ("default" in input && input.default !== undefined) return input.default;
  if (input.type === "number") return "";
  return "";
}

function isSatisfied(input: ManifestInput, value: unknown): boolean {
  if (!input.required) return true;
  if (input.type === "audio_upload" || input.type === "midi_upload") return typeof value === "string" && value.length > 0;
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function FieldControl({
  input,
  value,
  onChange,
}: {
  input: ManifestInput;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (input.type) {
    case "text":
      return (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "textarea":
      return (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder}
          rows={3}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={(value as string | number) ?? ""}
          min={input.min}
          max={input.max}
          step={input.step ?? 1}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "select":
      return (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="" disabled>
            Select…
          </option>
          {input.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "tags":
      return (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder ?? "comma-separated"}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "audio_upload":
    case "midi_upload":
      return (
        <input
          type="file"
          accept={input.accept}
          onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-xs outline-none file:mr-2 file:rounded-chip file:border-0 file:bg-ink/[0.08] file:px-3 file:py-1 file:text-xs"
        />
      );
    default:
      return null;
  }
}

type HardwareGateStatus =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "block"; message: string };

/**
 * Phase 8 hardware-gating: compares the selected variant's real VRAM
 * requirement against this machine's live free VRAM (queried once per
 * mount, not re-queried per keystroke — free VRAM doesn't change from
 * typing in a text field). A hard block is reserved for the one case a
 * generation is *guaranteed* to fail outright — no GPU detected at all and
 * the model has no CPU fallback path — since every other shortfall is only
 * an estimate: `minVramGb` is a documented minimum, not a live guarantee,
 * and other GPU memory can free up between now and when the job actually
 * runs. Warning (not blocking) in the uncertain cases respects the user's
 * own judgment about their hardware, per the roadmap's explicit guidance.
 */
function evaluateHardwareGate(manifest: ModelManifest, requiredVramGb: number, gpu: GpuVramInfo | null): HardwareGateStatus {
  if (!gpu) return { level: "ok" };
  if (requiredVramGb <= 0) return { level: "ok" };

  if (!gpu.available) {
    if (!manifest.hardware.cpuFallback) {
      return {
        level: "block",
        message: `${manifest.displayName} requires an NVIDIA GPU with ~${requiredVramGb}GB+ VRAM and has no CPU fallback — no GPU was detected on this machine.`,
      };
    }
    return {
      level: "warn",
      message: "No GPU detected — generation will run on CPU, which is much slower than the GPU path this model normally uses.",
    };
  }

  if (gpu.freeVramGb < requiredVramGb) {
    return {
      level: "warn",
      message: `This checkpoint needs about ${requiredVramGb}GB of VRAM; only ~${gpu.freeVramGb.toFixed(1)}GB is currently free on your GPU (${gpu.gpuName ?? "detected GPU"}). Generation may fail or run much slower than expected.`,
    };
  }

  return { level: "ok" };
}

function HardwareGateBanner({ status }: { status: HardwareGateStatus }) {
  if (status.level === "ok") return null;
  const isBlock = status.level === "block";
  return (
    <div
      role="alert"
      className={`rounded-[10px] border px-3 py-2 text-xs ${
        isBlock
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
    >
      {isBlock ? "Hardware requirement not met: " : "Hardware warning: "}
      {status.message}
    </div>
  );
}

export function DynamicGenerationForm({
  manifest,
  installedVariantNames,
  disabled,
  onSubmit,
}: DynamicGenerationFormProps) {
  const navigate = useNavigate();

  const usableVariants = useMemo(
    () => manifest.checkpointVariants.filter((v) => installedVariantNames.includes(v)),
    [manifest.checkpointVariants, installedVariantNames],
  );

  const [selectedVariant, setSelectedVariant] = useState<string>(usableVariants[0] ?? "");
  const [values, setValues] = useState<GenerationFormValues>(() => {
    const initial: GenerationFormValues = {};
    for (const input of manifest.inputs) initial[input.key] = defaultValueFor(input);
    return initial;
  });
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    kwesiHardware.gpuVram().then((info) => {
      if (!cancelled) setGpu(info);
    });
    return () => {
      cancelled = true;
    };
    // Queried once per mount — free VRAM doesn't meaningfully change while
    // this form is open, and re-querying per variant/field change would
    // just be extra nvidia-smi calls for no real benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (manifest.checkpointVariants.length === 0) {
    return (
      <EmptyState
        icon={<ModelsIcon width={24} height={24} />}
        title="No trained model available yet for this model family."
      />
    );
  }

  if (usableVariants.length === 0) {
    return (
      <EmptyState
        icon={<ModelsIcon width={24} height={24} />}
        title={`No installed checkpoint for ${manifest.displayName} yet.`}
        action={<PillButton onClick={() => navigate("/models")}>Open Model Manager</PillButton>}
      />
    );
  }

  const shown = visibleInputs(manifest.inputs, selectedVariant);
  const missingRequired = shown.some((input) => !isSatisfied(input, values[input.key]));
  const requiredVramGb = minVramGbFor(manifest, selectedVariant || null);
  const hardwareGate = evaluateHardwareGate(manifest, requiredVramGb, gpu);

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-3">
      {usableVariants.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          Checkpoint variant
          <select
            value={selectedVariant}
            onChange={(e) => setSelectedVariant(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          >
            {usableVariants.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      {shown.map((input) => (
        <label key={input.key} className="flex flex-col gap-1.5 text-sm">
          {input.label}
          {input.required && <span className="text-red-500"> *</span>}
          <FieldControl input={input} value={values[input.key]} onChange={(v) => setValue(input.key, v)} />
          {input.helpText && <span className="text-xs text-ink-muted">{input.helpText}</span>}
        </label>
      ))}

      <HardwareGateBanner status={hardwareGate} />

      <div className="mt-2 flex justify-end">
        <PillButton
          disabled={disabled || missingRequired || hardwareGate.level === "block"}
          onClick={() => onSubmit(selectedVariant || null, values)}
        >
          Generate
        </PillButton>
      </div>
    </div>
  );
}
