// Reconciles model_variant install_status against what's actually on disk
// at KWESI_MODELS_DIR. Needed because weights can land there from outside
// the app's own download queue -- e.g. scripts/download_models.py, a human
// manually placing a "manual"-source file (RAVE's pretrained .ts exports,
// Museformer's OneDrive checkpoint), or a future Cloudflare-hosted
// re-download path -- and the app should recognize them without requiring
// a redundant re-install through its own UI. Runs over every variant
// regardless of source; "manual" only affects whether the app itself can
// initiate a download, not whether it recognizes content already there.
import { modelVariantDir } from "../db/paths.js";
import { dirHasContent, dirSizeBytes } from "../lib/fsSize.js";
import * as repo from "../db/repositories.js";

export async function reconcileInstalledModelsFromDisk(): Promise<void> {
  const variants = repo.listAllModelVariants();

  for (const variant of variants) {
    const dir = modelVariantDir(variant.model_id, variant.variant_name);
    const present = await dirHasContent(dir);

    if (present && variant.install_status !== "installed") {
      const diskSizeBytes = await dirSizeBytes(dir);
      repo.setVariantInstalled(variant.id, dir, diskSizeBytes);
      console.log(`[reconcile] found ${variant.model_id}/${variant.variant_name} on disk -> marked installed (${diskSizeBytes} bytes)`);
    } else if (!present && variant.install_status === "installed") {
      // Files were removed outside the app (manual cleanup, moved disk, etc).
      repo.resetVariantToNotInstalled(variant.id);
      console.log(`[reconcile] ${variant.model_id}/${variant.variant_name} was installed but its folder is gone -> reset to not_installed`);
    }
  }
}
