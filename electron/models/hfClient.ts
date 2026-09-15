// Minimal Hugging Face Hub client for the Electron main process — no
// huggingface_hub/Python dependency, just the public HTTP API. Every repo
// used here is confirmed public/ungated (see kwesi.docs/03-model-catalog.md),
// so no token/login is required or supported.

export interface HfFileInfo {
  rfilename: string;
  size: number | null;
}

interface HfSibling {
  rfilename: string;
  size?: number;
}

interface HfModelApiResponse {
  siblings?: HfSibling[];
}

export function resolveFileUrl(repoId: string, rfilename: string): string {
  const encodedPath = rfilename
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://huggingface.co/${repoId}/resolve/main/${encodedPath}`;
}

async function headContentLength(repoId: string, rfilename: string): Promise<number | null> {
  try {
    const res = await fetch(resolveFileUrl(repoId, rfilename), { method: "HEAD" });
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

/**
 * Lists a repo's files with sizes. `?blobs=true` on the model API usually
 * returns each sibling's blob size directly; for any file it doesn't (rare),
 * falls back to a HEAD request against the resolve URL for content-length.
 */
export async function listRepoFiles(repoId: string): Promise<HfFileInfo[]> {
  const res = await fetch(`https://huggingface.co/api/models/${repoId}?blobs=true`);
  if (!res.ok) {
    throw new Error(`Hugging Face API error ${res.status} while listing ${repoId}`);
  }
  const data = (await res.json()) as HfModelApiResponse;
  const siblings = data.siblings ?? [];
  if (siblings.length === 0) {
    throw new Error(`Hugging Face repo ${repoId} reported no files`);
  }

  const files: HfFileInfo[] = [];
  for (const sibling of siblings) {
    let size = typeof sibling.size === "number" ? sibling.size : null;
    if (size === null) {
      size = await headContentLength(repoId, sibling.rfilename);
    }
    files.push({ rfilename: sibling.rfilename, size });
  }
  return files;
}
