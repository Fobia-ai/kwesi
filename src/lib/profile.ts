export interface ProfileData {
  displayName: string | null;
  email: string | null;
  avatarPath: string | null;
}

export interface KwesiProfileApi {
  get(): Promise<ProfileData>;
  save(displayName: string | null, email: string | null): Promise<void>;
}

function realProfileApi(bridge: NonNullable<Window["kwesi"]>["profile"]): KwesiProfileApi {
  return {
    async get() {
      const row = await bridge.get();
      return { displayName: row.display_name, email: row.email, avatarPath: row.avatar_path };
    },
    save: (displayName, email) => bridge.save(displayName, email),
  };
}

function createMockProfileApi(): KwesiProfileApi {
  const KEY = "kwesi-mock-profile";
  return {
    async get() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw) as ProfileData;
      } catch {
        // fall through to default
      }
      return { displayName: null, email: null, avatarPath: null };
    },
    async save(displayName, email) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ displayName, email, avatarPath: null }));
      } catch {
        // best-effort only
      }
    },
  };
}

export const kwesiProfile: KwesiProfileApi = window.kwesi?.profile
  ? realProfileApi(window.kwesi.profile)
  : createMockProfileApi();
