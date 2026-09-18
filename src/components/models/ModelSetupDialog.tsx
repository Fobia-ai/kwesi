import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { PillButton } from "../ui/PillButton";
import { getManifest } from "../../data/manifests";
import { kwesiDb, type ModelVariantRow } from "../../lib/db";
import { kwesiModels, type ModelsProgressEvent } from "../../lib/models";
import { kwesiEnvironment, type EnvStatus } from "../../lib/environment";

interface ModelSetupDialogProps {
  modelId: string;
  onClose: () => void;
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
export function ModelSetupDialog({ modelId, onClose }: ModelSetupDialogProps) {
  const navigate = useNavigate();
  const manifest = getManifest(modelId);
  const targetVariantName = manifest?.checkpointVariants[0] ?? null;

  const [variant, setVariant] = useState<ModelVariantRow | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [installingVariant, setInstallingVariant] = useState(false);
  const [installingEnv, setInstallingEnv] = useState(false);
  const [envLog, setEnvLog] = useState<string[]>([]);

  async function refreshVariant() {
    if (!targetVariantName) return;
    const variants = await kwesiDb.listModelVariants(modelId);
    setVariant(variants.find((v) => v.variant_name === targetVariantName) ?? null);
  }

  async function refreshEnv() {
    setEnvStatus(await kwesiEnvironment.checkStatus(modelId));
  }

  useEffect(() => {
    refreshVariant();
    refreshEnv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(
    () =>
      kwesiModels.onProgress((event: ModelsProgressEvent) => {
        if (event.modelId !== modelId || event.variantName !== targetVariantName) return;
        if (event.type === "installed" || event.type === "failed") setInstallingVariant(false);
        refreshVariant();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
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
    setInstallingEnv(true);
    await kwesiEnvironment.install(modelId);
    setInstallingEnv(false);
    refreshEnv();
  }

  const checkpointReady = variant?.install_status === "installed";
  const envReady = envStatus?.venvExists ?? false;
  const bothReady = checkpointReady && envReady;

  if (!manifest) return null;

  return (
    <Modal title={`Set up ${manifest.displayName}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-ink-muted">
          {manifest.displayName} needs both of these ready before it can generate.
        </p>

        <div className="rounded-[12px] bg-ink/[0.03] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Model weights</p>
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
                className="!px-3 !py-1.5 text-xs"
                onClick={installVariant}
                disabled={installingVariant || variant?.install_status === "downloading" || variant?.install_status === "queued"}
              >
                {variant?.install_status === "failed" ? "Retry" : "Install"}
              </PillButton>
            )}
          </div>
        </div>

        <div className="rounded-[12px] bg-ink/[0.03] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Environment</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {envReady ? "Ready" : installingEnv ? "Installing…" : "Not installed"}
              </p>
            </div>
            {!envReady && (
              <PillButton className="!px-3 !py-1.5 text-xs" onClick={installEnv} disabled={installingEnv}>
                Set up
              </PillButton>
            )}
          </div>
          {envLog.length > 0 && (
            <pre className="kwesi-scroll-inset mt-2 max-h-24 overflow-y-auto rounded-[8px] bg-ink/[0.05] p-2 font-mono text-[10px] leading-relaxed text-ink-muted">
              {envLog.join("\n")}
            </pre>
          )}
        </div>

        <button
          type="button"
          className="text-left text-xs text-ink-muted underline hover:text-ink"
          onClick={() => navigate(`/settings?tab=Environment`, { state: { highlightModelId: modelId } })}
        >
          Or open Settings → Environment
        </button>

        <div className="mt-1 flex justify-end">
          <PillButton onClick={onClose} variant={bothReady ? "accent" : "ghost"}>
            {bothReady ? "Continue" : "Close"}
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}
