// Settings > Reset: the user picks which categories of local data to wipe
// (checkboxes), and "Clean" removes only those -- both the on-disk files and
// the DB rows that describe them, so nothing is left half-erased (a folder
// gone but the DB still thinking it's installed, or vice versa).
import * as repo from "./db/repositories.js";
import {
  modelsRootDir,
  workspacesRootDir,
  trainedModelsRootDir,
  artistAvatarsRootDir,
  exportsRootDir,
  ensureDir,
  removeDirIfExists,
} from "./db/paths.js";
import { cancelAllJobs } from "./models/downloadQueue.js";
import { hasActiveGenerationJobs } from "./models/modelServer.js";

export const RESET_CATEGORIES = ["models", "music", "trainedModels", "artistProfiles", "exports"] as const;
export type ResetCategory = (typeof RESET_CATEGORIES)[number];

function isResetCategory(value: string): value is ResetCategory {
  return (RESET_CATEGORIES as readonly string[]).includes(value);
}

export async function resetCategories(categories: string[]): Promise<{ ok: boolean; reason?: string }> {
  const wanted = categories.filter(isResetCategory);
  if (wanted.length === 0) return { ok: false, reason: "No categories selected" };

  // Checked here (not just in the renderer) so a generation that starts
  // between the renderer's own check and this call still gets caught --
  // wiping KWESI_WORKSPACES_DIR out from under a job that's actively writing
  // into it would corrupt that generation's output, not just cancel it
  // cleanly the way an install-queue download's abort does.
  if (hasActiveGenerationJobs()) {
    return { ok: false, reason: "Can't reset while a generation is running — wait for it to finish or cancel it first." };
  }

  const set = new Set(wanted);

  if (set.has("models")) {
    cancelAllJobs();
    removeDirIfExists(modelsRootDir());
    ensureDir(modelsRootDir());
    repo.resetAllInstalledModelVariants();
  }
  if (set.has("music")) {
    removeDirIfExists(workspacesRootDir());
    ensureDir(workspacesRootDir());
    repo.deleteAllWorkspaces();
  }
  if (set.has("trainedModels")) {
    removeDirIfExists(trainedModelsRootDir());
    ensureDir(trainedModelsRootDir());
    repo.deleteAllTrainedModelData();
  }
  if (set.has("artistProfiles")) {
    removeDirIfExists(artistAvatarsRootDir());
    ensureDir(artistAvatarsRootDir());
    repo.deleteAllArtistProfiles();
  }
  if (set.has("exports")) {
    removeDirIfExists(exportsRootDir());
    ensureDir(exportsRootDir());
  }

  return { ok: true };
}
