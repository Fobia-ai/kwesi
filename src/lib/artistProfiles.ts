export interface ArtistProfile {
  id: string;
  name: string;
  bio: string | null;
  avatarPath: string | null;
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
  create(name: string, bio: string | null): Promise<ArtistProfile>;
  update(id: string, name: string, bio: string | null): Promise<void>;
  delete(id: string): Promise<void>;
  setAvatar(id: string, sourcePath: string): Promise<SetAvatarResult>;
  removeAvatar(id: string): Promise<void>;
  readAvatar(avatarPath: string): Promise<ReadAvatarResult>;
}

function fromRow(row: {
  id: string;
  name: string;
  bio: string | null;
  avatar_path: string | null;
  created_at: number;
  updated_at: number;
}): ArtistProfile {
  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function realArtistProfilesApi(bridge: NonNullable<Window["kwesi"]>["artistProfiles"]): KwesiArtistProfilesApi {
  return {
    async list() {
      return (await bridge.list()).map(fromRow);
    },
    async create(name, bio) {
      return fromRow(await bridge.create(name, bio));
    },
    update: (id, name, bio) => bridge.update(id, name, bio),
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
      return raw ? (JSON.parse(raw) as ArtistProfile[]) : [];
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
    async create(name, bio) {
      const now = Date.now();
      const profile: ArtistProfile = {
        id: crypto.randomUUID(),
        name,
        bio,
        avatarPath: null,
        createdAt: now,
        updatedAt: now,
      };
      save([...load(), profile]);
      return profile;
    },
    async update(id, name, bio) {
      save(load().map((p) => (p.id === id ? { ...p, name, bio, updatedAt: Date.now() } : p)));
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
