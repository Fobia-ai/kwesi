import { useEffect, useState } from "react";
import { MANIFESTS, type ModelHardware, type KwesiPlatform } from "../../data/manifests";
import { kwesiEnvironment, type EnvStatus } from "../../lib/environment";
import { kwesiHardware, type GpuVramInfo } from "../../lib/hardware";
import { openExternal } from "../../lib/kwesiBridge";
import { PillButton } from "../ui/PillButton";

const PLATFORM_LABEL: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

function PrereqRow({ label, info }: { label: string; info: { available: boolean; version: string | null } }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/[0.07] py-2 last:border-b-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`text-xs ${info.available ? "text-ink" : "text-red-600"}`}>
        {info.available ? (info.version ?? "Found") : "Not found"}
      </span>
    </div>
  );
}

function ModelRow({ modelId, displayName, hardware, currentPlatform, gpu }: {
  modelId: string;
  displayName: string;
  hardware: ModelHardware;
  currentPlatform: string;
  gpu: GpuVramInfo;
}) {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  async function refresh() {
    setChecking(true);
    const result = await kwesiEnvironment.checkStatus(modelId);
    setChecking(false);
    setStatus(result);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(
    () =>
      kwesiEnvironment.onProgress((event) => {
        if (event.modelId !== modelId) return;
        setLog((prev) => [...prev.slice(-49), event.line]);
      }),
    [modelId],
  );

  const platformOk = !hardware.platforms || hardware.platforms.includes(currentPlatform as KwesiPlatform);
  const gpuOk = hardware.cpuFallback || hardware.minVramGb === 0 || (gpu.available && gpu.totalVramGb >= hardware.minVramGb);

  async function handleInstall() {
    setInstallMessage(null);
    setLog([]);
    setInstalling(true);
    const result = await kwesiEnvironment.install(modelId);
    setInstalling(false);
    if (!result.ok) setInstallMessage(result.reason ?? "Install failed.");
    await refresh();
  }

  const statusLine = checking
    ? "Checking…"
    : !status?.venvExists
      ? "Not installed"
      : [
          status.pythonVersion ?? "Python",
          `torch ${status.torchAvailable ? "ok" : "missing"}`,
          status.cudaAvailable !== null ? `CUDA ${status.cudaAvailable ? "available" : "not available"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="rounded-[12px] bg-ink/[0.03] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{displayName}</span>
            {!platformOk && (
              <span className="rounded-chip bg-red-500/12 px-2 py-0.5 text-[10px] font-medium text-red-600">
                Not supported on {PLATFORM_LABEL[currentPlatform] ?? currentPlatform}
              </span>
            )}
            {platformOk && !gpuOk && (
              <span className="rounded-chip bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                Needs {hardware.minVramGb}GB+ VRAM
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">{statusLine}</p>
          {installMessage && <p className="mt-1 text-xs text-red-600">{installMessage}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PillButton variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={refresh} disabled={checking || installing}>
            Check
          </PillButton>
          {status?.venvExists ? (
            <span className="text-xs text-accent">Installed</span>
          ) : status?.installable ? (
            <PillButton className="!px-3 !py-1.5 text-xs" onClick={handleInstall} disabled={installing || !platformOk}>
              {installing ? "Installing…" : "Install"}
            </PillButton>
          ) : (
            <span className="text-xs text-ink-muted" title={hardware.notes}>
              Not automatable
            </span>
          )}
        </div>
      </div>
      {log.length > 0 && (
        <pre className="kwesi-scroll-inset mt-2 max-h-32 overflow-y-auto rounded-[8px] bg-ink/[0.05] p-2 font-mono text-[10px] leading-relaxed text-ink-muted">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}

/**
 * The automated counterpart to every servers/<model>/README.md's by-hand
 * setup instructions -- real venv creation and package installs, via `uv`
 * (see electron/models/envInstaller.ts for exactly what each model's
 * Install button runs and why). Not every model can be automated yet:
 * Museformer's own inference path has never been verified end-to-end, so
 * it stays check-only rather than pretending an install path exists for
 * something that might not work regardless.
 */
export function EnvironmentTab() {
  const [prereqs, setPrereqs] = useState<{
    uv: { available: boolean; version: string | null };
    git: { available: boolean; version: string | null };
    platform: string;
  } | null>(null);
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);

  useEffect(() => {
    kwesiEnvironment.checkPrerequisites().then(setPrereqs);
    kwesiHardware.gpuVram().then(setGpu);
  }, []);

  const models = Object.values(MANIFESTS);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-xs text-ink-muted">
        Each model generates in its own real Python environment under your Venvs folder. Check or install them here
        instead of a terminal — see each model's <code className="text-[11px]">servers/&lt;model&gt;/README.md</code>{" "}
        for exactly what a real by-hand setup involves.
      </p>

      <section>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Prerequisites</p>
        {prereqs ? (
          <>
            <PrereqRow label="uv (Python & package manager)" info={prereqs.uv} />
            <PrereqRow label="git" info={prereqs.git} />
            {!prereqs.uv.available && (
              <p className="mt-2 text-xs text-amber-600">
                uv isn't installed, so nothing below can install automatically yet — get it from{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => openExternal("https://docs.astral.sh/uv/getting-started/installation/")}
                >
                  docs.astral.sh/uv
                </button>
                , then reopen this tab.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-muted">Checking…</p>
        )}
      </section>

      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Model environments</p>
        <div className="flex flex-col gap-2">
          {models.map((m) => (
            <ModelRow
              key={m.modelId}
              modelId={m.modelId}
              displayName={m.displayName}
              hardware={m.hardware}
              currentPlatform={prereqs?.platform ?? "linux"}
              gpu={gpu ?? { available: false, totalVramGb: 0, freeVramGb: 0 }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
