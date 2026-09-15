import fs from "node:fs";
import path from "node:path";

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else {
      const stat = await fs.promises.stat(full);
      total += stat.size;
    }
  }
  return total;
}

export async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}
