// Reconciles model_variant install_status against what's actually on disk
// at KWESI_MODELS_DIR. Needed because weights can land there from outside
// the app's own download queue -- e.g. scripts/download_models.py, a human
// manually placing a "manual"-source file (RAVE's pretrained .ts exports,
// Museformer's OneDrive checkpoint), a future Cloudflare-hosted re-download
// path, or the user pointing Settings > System's Models folder at a
// directory they already populated -- and the app should recognize them
// without requiring a redundant re-install through its own UI.
//
// Split into a read-only detectModelDrift (what *would* change) and an
// apply-and-report reconcileInstalledModelsFromDisk, so the same disk scan
// backs both the silent startup sweep (main.ts) and Settings/Home's
// user-facing "your models folder doesn't match what's on record" flow --
// the Home resolver needs to know whether there's anything to show
// *before* committing to changing DB state.
import { modelVariantDir } from "../db/paths.js";
import { dirHasContent, dirSizeBytes } from "../lib/fsSize.js";
import * as repo from "../db/repositories.js";

export interface ModelDriftEntry {
  variantId: string;
  modelId: string;
  variantName: string;
}

export interface ModelDrift {
  // On disk but not marked installed -- newly discovered.
  toInstalled: (ModelDriftEntry & { diskSizeBytes: number })[];
  // Marked installed but the folder is gone or empty.
  toNotInstalled: ModelDriftEntry[];
}

export function isEmptyModelDrift(drift: ModelDrift): boolean {
  return drift.toInstalled.length === 0 && drift.toNotInstalled.length === 0;
}

type DriftCheck =
  | { kind: "toInstalled"; entry: ModelDriftEntry & { diskSizeBytes: number } }
  | { kind: "toNotInstalled"; entry: ModelDriftEntry }
  | { kind: "none" };

async function checkVariant(variant: repo.ModelVariantRow): Promise<DriftCheck> {
  const dir = modelVariantDir(variant.model_id, variant.variant_name);
  const present = await dirHasContent(dir);
  const entry = { variantId: variant.id, modelId: variant.model_id, variantName: variant.variant_name };

  if (present && variant.install_status !== "installed") {
    return { kind: "toInstalled", entry: { ...entry, diskSizeBytes: await dirSizeBytes(dir) } };
  }
  if (!present && variant.install_status === "installed") {
    return { kind: "toNotInstalled", entry };
  }
  return { kind: "none" };
}

// Every variant's disk check runs concurrently (each is just a readdir plus,
// rarely, a recursive size walk for one newly-found folder) rather than
// awaited one at a time -- this now runs not just once at startup but on
// every Settings > System models-folder change and every Home resolver
// click, so its wall time scales with the slowest single variant check
// instead of the sum of all of them.
async function computeDrift(): Promise<ModelDrift> {
  const variants = repo.listAllModelVariants();
  const results = await Promise.all(variants.map(checkVariant));

  const toInstalled: ModelDrift["toInstalled"] = [];
  const toNotInstalled: ModelDrift["toNotInstalled"] = [];
  for (const result of results) {
    if (result.kind === "toInstalled") toInstalled.push(result.entry);
    else if (result.kind === "toNotInstalled") toNotInstalled.push(result.entry);
  }

  return { toInstalled, toNotInstalled };
}

/** Read-only -- what reconcileInstalledModelsFromDisk would change, without changing anything. */
export async function detectModelDrift(): Promise<ModelDrift> {
  return computeDrift();
}

export async function reconcileInstalledModelsFromDisk(): Promise<ModelDrift> {
  const drift = await computeDrift();

  for (const entry of drift.toInstalled) {
    const dir = modelVariantDir(entry.modelId, entry.variantName);
    repo.setVariantInstalled(entry.variantId, dir, entry.diskSizeBytes);
    console.log(
      `[reconcile] found ${entry.modelId}/${entry.variantName} on disk -> marked installed (${entry.diskSizeBytes} bytes)`,
    );
  }
  for (const entry of drift.toNotInstalled) {
    repo.resetVariantToNotInstalled(entry.variantId);
    console.log(
      `[reconcile] ${entry.modelId}/${entry.variantName} was installed but its folder is gone -> reset to not_installed`,
    );
  }

  return drift;
}
