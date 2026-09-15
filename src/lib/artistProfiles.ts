export interface ArtistProfile {
  id: string;
  name: string;
  bio: string | null;
  avatarPath: string | null;
  genres: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SetAvatarResult {
  ok: boolean;
  avatarPath?: string;
  reason?: string;
}

export interface ReadAvatarResult {
  ok: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
  reason?: string;
}

export interface KwesiArtistProfilesApi {
  list(): Promise<ArtistProfile[]>;
  create(name: string, bio: string | null, genres: string[]): Promise<ArtistProfile>;
  update(id: string, name: string, bio: string | null, genres: string[]): Promise<void>;
  delete(id: string): Promise<void>;
  setAvatar(id: string, sourcePath: string): Promise<SetAvatarResult>;
  removeAvatar(id: string): Promise<void>;
  readAvatar(avatarPath: string): Promise<ReadAvatarResult>;
}

function parseGenres(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: {
  id: string;
  name: string;
  bio: string | null;
  avatar_path: string | null;
  genres: string;
  created_at: number;
  updated_at: number;
}): ArtistProfile {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    avatarPath: row.avatar_path,
    genres: parseGenres(row.genres),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function realArtistProfilesApi(bridge: NonNullable<Window["kwesi"]>["artistProfiles"]): KwesiArtistProfilesApi {
  return {
    async list() {
      return (await bridge.list()).map(fromRow);
    },
    async create(name, bio, genres) {
      return fromRow(await bridge.create(name, bio, genres));
    },
    update: (id, name, bio, genres) => bridge.update(id, name, bio, genres),
    delete: (id) => bridge.delete(id),
    setAvatar: (id, sourcePath) => bridge.setAvatar(id, sourcePath),
    removeAvatar: (id) => bridge.removeAvatar(id),
    readAvatar: (avatarPath) => bridge.readAvatar(avatarPath),
  };
}

/**
 * localStorage-backed mock for browser-preview dev. Avatar upload has the
 * same known gap every other upload field has in mock mode (documented in
 * servers/ace-step-1.5/README.md's "Manifest mapping notes" for
 * reference_audio): DynamicGenerationForm's upload handler only ever
 * captures a real path via Electron's webUtils bridge, so outside Electron
 * there's nothing real to read — setAvatar here just fails gracefully
 * rather than pretending to store an image, and the UI falls back to
 * initials, same as a profile with no avatar at all.
 */
function createMockArtistProfilesApi(): KwesiArtistProfilesApi {
  const KEY = "kwesi-mock-artist-profiles";

  function load(): ArtistProfile[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ArtistProfile[];
      // Backfills records saved before `genres` existed — the mock has no
      // real migration path the way the real DB does (see database.ts's
      // migrateArtistProfileColumns), so a stale browser-preview localStorage
      // entry would otherwise carry `genres: undefined` and crash anything
      // that reads .genres.length.
      return parsed.map((p) => ({ ...p, genres: p.genres ?? [] }));
    } catch {
      return [];
    }
  }

  function save(profiles: ArtistProfile[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(profiles));
    } catch {
      // best-effort only
    }
  }

  return {
    async list() {
      return load().sort((a, b) => a.name.localeCompare(b.name));
    },
    async create(name, bio, genres) {
      const now = Date.now();
      const profile: ArtistProfile = {
        id: crypto.randomUUID(),
        name,
        bio,
        avatarPath: null,
        genres,
        createdAt: now,
        updatedAt: now,
      };
      save([...load(), profile]);
      return profile;
    },
    async update(id, name, bio, genres) {
      save(load().map((p) => (p.id === id ? { ...p, name, bio, genres, updatedAt: Date.now() } : p)));
    },
    async delete(id) {
      save(load().filter((p) => p.id !== id));
    },
    async setAvatar() {
      return { ok: false, reason: "Avatar upload isn't available in the browser preview — only inside the app." };
    },
    async removeAvatar(id) {
      save(load().map((p) => (p.id === id ? { ...p, avatarPath: null, updatedAt: Date.now() } : p)));
    },
    async readAvatar() {
      return { ok: false, reason: "Not available in the browser preview." };
    },
  };
}

export const kwesiArtistProfiles: KwesiArtistProfilesApi = window.kwesi?.artistProfiles
  ? realArtistProfilesApi(window.kwesi.artistProfiles)
  : createMockArtistProfilesApi();
