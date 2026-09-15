import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { artistAvatarsRootDir, artistAvatarPath } from "../db/paths.js";

const ALLOWED_AVATAR_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function mimeTypeForAvatar(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

// Same path-boundary-safety posture as electron/ipc/audio.ts's
// isWithinWorkspaces — a renderer asking to read anything outside the
// avatars directory is treated as untrusted, not honored.
function isWithinAvatarsDir(filePath: string): boolean {
  const root = path.resolve(artistAvatarsRootDir());
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export interface SetAvatarResult {
  ok: boolean;
  avatarPath?: string;
  reason?: string;
}

async function setAvatar(profileId: string, sourcePath: string): Promise<SetAvatarResult> {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Unsupported image type "${ext || "unknown"}" — use PNG, JPG, WEBP, or GIF.` };
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(sourcePath);
  } catch {
    return { ok: false, reason: "Couldn't read that file." };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { ok: false, reason: "That file is empty or not a real file." };
  }

  const existing = repo.getArtistProfile(profileId);
  if (existing?.avatar_path) {
    await fs.promises.rm(existing.avatar_path, { force: true });
  }

  const destPath = artistAvatarPath(profileId, ext);
  await fs.promises.copyFile(sourcePath, destPath);
  repo.setArtistProfileAvatarPath(profileId, destPath);
  return { ok: true, avatarPath: destPath };
}

async function removeAvatar(profileId: string): Promise<void> {
  const existing = repo.getArtistProfile(profileId);
  if (existing?.avatar_path) {
    await fs.promises.rm(existing.avatar_path, { force: true });
  }
  repo.setArtistProfileAvatarPath(profileId, null);
}

export interface ReadAvatarResult {
  ok: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
  reason?: string;
}

async function readAvatar(avatarPath: string): Promise<ReadAvatarResult> {
  if (!isWithinAvatarsDir(avatarPath)) return { ok: false, reason: "Path outside artist avatars directory" };
  try {
    const buf = await fs.promises.readFile(avatarPath);
    if (buf.byteLength === 0) return { ok: false, reason: "File is empty" };
    return { ok: true, bytes: new Uint8Array(buf), mimeType: mimeTypeForAvatar(avatarPath) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function registerArtistProfilesIpcHandlers() {
  ipcMain.handle("kwesi:artistProfiles:list", () => repo.listArtistProfiles());
  ipcMain.handle("kwesi:artistProfiles:create", (_e, name: string, bio: string | null) =>
    repo.createArtistProfile(name, bio),
  );
  ipcMain.handle("kwesi:artistProfiles:update", (_e, id: string, name: string, bio: string | null) =>
    repo.updateArtistProfile(id, name, bio),
  );
  ipcMain.handle("kwesi:artistProfiles:delete", async (_e, id: string) => {
    const existing = repo.getArtistProfile(id);
    if (existing?.avatar_path) await fs.promises.rm(existing.avatar_path, { force: true });
    repo.deleteArtistProfile(id);
  });
  ipcMain.handle("kwesi:artistProfiles:setAvatar", (_e, id: string, sourcePath: string) =>
    setAvatar(id, sourcePath),
  );
  ipcMain.handle("kwesi:artistProfiles:removeAvatar", (_e, id: string) => removeAvatar(id));
  ipcMain.handle("kwesi:artistProfiles:readAvatar", (_e, avatarPath: string) => readAvatar(avatarPath));
}
