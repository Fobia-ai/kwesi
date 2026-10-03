import fs from "node:fs";
import path from "node:path";

export async function dirSizeBytes(dir: string): Promise<number> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return dirSizeBytes(full);
      const stat = await fs.promises.stat(full);
      return stat.size;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

export async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** Size of a file, or of everything under a directory; null if the path is missing or empty. */
export async function pathContentBytes(target: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(target);
    if (stat.isFile()) return stat.size > 0 ? stat.size : null;
    if (!(await dirHasContent(target))) return null;
    return await dirSizeBytes(target);
  } catch {
    return null;
  }
}
