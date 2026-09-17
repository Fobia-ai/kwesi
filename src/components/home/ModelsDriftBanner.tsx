import { useEffect, useState } from "react";
import { PillButton } from "../ui/PillButton";
import { kwesiSettings, type ModelDrift } from "../../lib/settings";

function isEmpty(drift: ModelDrift): boolean {
  return drift.toInstalled.length === 0 && drift.toNotInstalled.length === 0;
}

function describeDrift(drift: ModelDrift): string {
  const parts: string[] = [];
  if (drift.toInstalled.length > 0) {
    parts.push(
      `${drift.toInstalled.length} model${drift.toInstalled.length === 1 ? "" : "s"} found on disk that aren't marked installed`,
    );
  }
  if (drift.toNotInstalled.length > 0) {
    parts.push(
      `${drift.toNotInstalled.length} model${drift.toNotInstalled.length === 1 ? "" : "s"} marked installed but missing from disk`,
    );
  }
  return parts.join("; ") + ".";
}

/**
 * Surfaces on Home when the models folder (Settings > System > Models
 * folder) doesn't match what the DB thinks is installed -- either because
 * the user pointed it at a folder with models already in it, or because
 * files moved/disappeared outside the app entirely. checkModelsDrift is
 * read-only (electron/models/reconcile.ts's detectModelDrift), so this
 * never changes anything on its own; only the explicit Resolve click does,
 * via the same reconciler the startup sweep already uses.
 */
export function ModelsDriftBanner() {
  const [drift, setDrift] = useState<ModelDrift | null>(null);
  const [resolving, setResolving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    kwesiSettings.checkModelsDrift().then(setDrift);
  }, []);

  if (dismissed || !drift || isEmpty(drift)) return null;

  async function handleResolve() {
    setResolving(true);
    const result = await kwesiSettings.resolveModelsDrift();
    setResolving(false);
    setDrift(result);
  }

  return (
    <div className="kwesi-glass mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-[12px] px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Your models folder doesn't match what's on record.</p>
        <p className="text-xs text-ink-muted">
          {describeDrift(drift)} If you changed the models folder yourself, move your old models into the new one
          first to avoid re-downloading anything, then resolve.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PillButton disabled={resolving} onClick={handleResolve} className="!px-3 !py-1.5 text-xs">
          {resolving ? "Resolving…" : "Resolve"}
        </PillButton>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
