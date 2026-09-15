export interface SetPasscodeResult {
  ok: boolean;
  reason?: string;
}

export interface KwesiSecurityApi {
  hasPasscode(): Promise<boolean>;
  setPasscode(passcode: string): Promise<SetPasscodeResult>;
  removePasscode(): Promise<void>;
  verifyPasscode(attempt: string): Promise<boolean>;
  getIdleTimeoutMinutes(): Promise<number>;
  setIdleTimeoutMinutes(minutes: number): Promise<void>;
}

function realSecurityApi(bridge: NonNullable<Window["kwesi"]>["security"]): KwesiSecurityApi {
  return {
    hasPasscode: () => bridge.hasPasscode(),
    setPasscode: (passcode) => bridge.setPasscode(passcode),
    removePasscode: () => bridge.removePasscode(),
    verifyPasscode: (attempt) => bridge.verifyPasscode(attempt),
    getIdleTimeoutMinutes: () => bridge.getIdleTimeoutMinutes(),
    setIdleTimeoutMinutes: (minutes) => bridge.setIdleTimeoutMinutes(minutes),
  };
}

/**
 * localStorage-backed mock for browser-preview dev — stores the passcode in
 * plain text, which is fine here since this path never runs inside the real
 * app (window.kwesi is undefined) and exists purely so the lock-screen UI is
 * exercisable without Electron's safeStorage/OS keychain available.
 */
function createMockSecurityApi(): KwesiSecurityApi {
  const PASSCODE_KEY = "kwesi-mock-passcode";
  const IDLE_KEY = "kwesi-mock-idle-timeout";

  return {
    async hasPasscode() {
      try {
        return localStorage.getItem(PASSCODE_KEY) !== null;
      } catch {
        return false;
      }
    },
    async setPasscode(passcode) {
      if (!passcode || passcode.length < 4) return { ok: false, reason: "Passcode must be at least 4 characters." };
      try {
        localStorage.setItem(PASSCODE_KEY, passcode);
      } catch {
        // best-effort only
      }
      return { ok: true };
    },
    async removePasscode() {
      try {
        localStorage.removeItem(PASSCODE_KEY);
      } catch {
        // best-effort only
      }
    },
    async verifyPasscode(attempt) {
      try {
        const stored = localStorage.getItem(PASSCODE_KEY);
        return stored === null || stored === attempt;
      } catch {
        return true;
      }
    },
    async getIdleTimeoutMinutes() {
      try {
        const stored = localStorage.getItem(IDLE_KEY);
        return stored ? Number(stored) : 10;
      } catch {
        return 10;
      }
    },
    async setIdleTimeoutMinutes(minutes) {
      try {
        localStorage.setItem(IDLE_KEY, String(minutes));
      } catch {
        // best-effort only
      }
    },
  };
}

export const kwesiSecurity: KwesiSecurityApi = window.kwesi?.security
  ? realSecurityApi(window.kwesi.security)
  : createMockSecurityApi();
