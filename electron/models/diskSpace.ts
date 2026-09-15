import fs from "node:fs";
import path from "node:path";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${exponent === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Walks up to the nearest existing ancestor — statfs needs a path that exists. */
function nearestExistingAncestor(dir: string): string {
  let probe = dir;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return probe;
}

export async function getFreeBytes(dir: string): Promise<number | null> {
  try {
    const stats = await fs.promises.statfs(nearestExistingAncestor(dir));
    return stats.bavail * stats.bsize;
  } catch {
    // fs.promises.statfs is available on the Node versions Electron bundles
    // here, but if it isn't on some platform, don't hard-fail the download
    // path over it — just skip the pre-check (see checkDiskSpace below).
    return null;
  }
}

export interface DiskSpaceCheck {
  ok: boolean;
  reason?: string;
}

/**
 * v1 simplification: this is a best-effort pre-check, not a hard guarantee
 * — it compares free space against the sum of the repo's declared file
 * sizes with a 5% safety margin before any bytes are written. If free-space
 * detection itself fails (statfs unsupported/erroring), the download is
 * allowed to proceed rather than being silently blocked.
 */
export async function checkDiskSpace(dir: string, neededBytes: number): Promise<DiskSpaceCheck> {
  const freeBytes = await getFreeBytes(dir);
  if (freeBytes === null) return { ok: true };
  const withMargin = neededBytes * 1.05;
  if (freeBytes < withMargin) {
    return {
      ok: false,
      reason: `Not enough free disk space: need about ${formatBytes(withMargin)}, only ${formatBytes(freeBytes)} free.`,
    };
  }
  return { ok: true };
}
