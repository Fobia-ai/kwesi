import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { PillButton } from "../ui/PillButton";
import { InsetCard } from "../ui/InsetCard";
import { LogPanel } from "../ui/LogPanel";
import { Callout } from "../ui/Callout";
import { getManifest } from "../../data/manifests";
import { kwesiDb, type ModelVariantRow } from "../../lib/db";
import { kwesiModels, type ModelsProgressEvent } from "../../lib/models";
import { kwesiEnvironment, type EnvStatus } from "../../lib/environment";

interface ModelSetupDialogProps {
  modelId: string;
  onClose: () => void;
  // "train" checks/installs the TRAINING environment (RAVE trains in its own
  // `rave-train` venv; the others reuse their inference one) instead of the
  // inference environment.
  purpose?: "generate" | "train";
  // The weights that must be installed. Defaults to the manifest's first
  // checkpoint variant; a training run passes the base it fine-tunes from,
  // or null when it needs no local weights (RAVE trains from scratch,
  // MusicGen fetches its base through AudioCraft's own //pretrained alias).
  variantName?: string | null;
}

/**
 * Shared by both gates that need it (Workspaces.tsx's creation gate,
 * WorkspaceDetail.tsx's generation-start gate): a model isn't usable until
 * it has both a real installed checkpoint AND a real Python environment.
 * Each row's action button reuses the exact same real install calls Model
 * Manager (kwesiModels.install) and Settings > Environment
 * (kwesiEnvironment.install) already use -- this is a shortcut to those
 * same real actions, not a separate/lesser mechanism.
 */
export function ModelSetupDialog({ modelId, onClose, purpose = "generate", variantName }: ModelSetupDialogProps) {
  const navigate = useNavigate();
  const manifest = getManifest(modelId);
  const targetVariantName = variantName === undefined ? (manifest?.checkpointVariants[0] ?? null) : variantName;
  const training = purpose === "train";

  const [variant, setVariant] = useState<ModelVariantRow | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [installingVariant, setInstallingVariant] = useState(false);
  const [installingEnv, setInstallingEnv] = useState(false);
  const [envLog, setEnvLog] = useState<string[]>([]);
  const [envError, setEnvError] = useState<string | null>(null);

  async function refreshVariant() {
    if (!targetVariantName) return;
    const variants = await kwesiDb.listModelVariants(modelId);
    setVariant(variants.find((v) => v.variant_name === targetVariantName) ?? null);
  }

  async function refreshEnv() {
    setEnvStatus(
      await (training ? kwesiEnvironment.checkTrainingStatus(modelId) : kwesiEnvironment.checkStatus(modelId)),
    );
  }

  useEffect(() => {
    refreshVariant();
    refreshEnv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, targetVariantName, training]);

  useEffect(
    () =>
      kwesiModels.onProgress((event: ModelsProgressEvent) => {
        if (event.modelId !== modelId || event.variantName !== targetVariantName) return;
        if (event.type === "installed" || event.type === "failed") setInstallingVariant(false);
        refreshVariant();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelId, targetVariantName],
  );

  useEffect(
    () =>
      kwesiEnvironment.onProgress((event) => {
        if (event.modelId !== modelId) return;
        setEnvLog((prev) => [...prev.slice(-19), event.line]);
      }),
    [modelId],
  );

  async function installVariant() {
    if (!targetVariantName) return;
    setInstallingVariant(true);
    const result = await kwesiModels.install(modelId, targetVariantName);
    if (!result.ok) setInstallingVariant(false);
  }

  async function installEnv() {
    setEnvLog([]);
    setEnvError(null);
    setInstallingEnv(true);
    const result = await (training ? kwesiEnvironment.installTraining(modelId) : kwesiEnvironment.install(modelId));
    setInstallingEnv(false);
    if (!result.ok) setEnvError(result.reason ?? "Install failed.");
    refreshEnv();
  }

  const checkpointReady = !targetVariantName || variant?.install_status === "installed";
  const envReady = envStatus?.venvExists ?? false;
  const bothReady = checkpointReady && envReady;

  if (!manifest) return null;

  return (
    <Modal title={`Set up ${manifest.displayName}${training ? " training" : ""}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-ink-muted">
          {training
            ? `Training ${manifest.displayName} needs ${targetVariantName ? "these" : "this"} ready first — a one-time setup (real downloads and Python packages, may take several minutes).`
            : `${manifest.displayName} needs both of these ready before it can generate.`}
        </p>

        {targetVariantName && (
        <InsetCard>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{training ? `Base weights · ${targetVariantName}` : "Model weights"}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {checkpointReady
                  ? "Installed"
                  : variant?.install_status === "downloading" || variant?.install_status === "queued"
                    ? "Downloading…"
                    : variant?.install_status === "failed"
                      ? (variant.error ?? "Install failed")
                      : "Not installed"}
              </p>
            </div>
            {!checkpointReady && (
              <PillButton
                size="sm"
                onClick={installVariant}
                disabled={installingVariant || variant?.install_status === "downloading" || variant?.install_status === "queued"}
              >
                {variant?.install_status === "failed" ? "Retry" : "Install"}
              </PillButton>
            )}
          </div>
        </InsetCard>
        )}

        <InsetCard>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{training ? "Training environment" : "Environment"}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {envReady ? "Ready" : installingEnv ? "Installing…" : "Not installed"}
              </p>
            </div>
            {!envReady && (
              <PillButton size="sm" onClick={installEnv} disabled={installingEnv}>
                Set up
              </PillButton>
            )}
          </div>
          <LogPanel lines={envLog} className="mt-2" />
          {envError && <Callout tone="error" className="mt-2">{envError}</Callout>}
        </InsetCard>

        <button
          type="button"
          className="text-left text-xs text-ink-muted underline hover:text-ink"
          onClick={() => navigate(`/settings?tab=Environment`, { state: { highlightModelId: modelId } })}
        >
          Or open Settings → Environment
        </button>

        <div className="mt-1 flex justify-end">
          <PillButton onClick={onClose} variant={bothReady ? "accent" : "ghost"}>
            {bothReady ? (training ? "Done — start the run" : "Continue") : "Close"}
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}
