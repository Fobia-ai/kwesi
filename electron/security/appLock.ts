import { safeStorage } from "electron";
import * as repo from "../db/repositories.js";

const PASSCODE_KEY = "app_lock_passcode_encrypted";
const IDLE_TIMEOUT_KEY = "app_lock_idle_timeout_minutes";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasPasscode(): boolean {
  return repo.getSetting(PASSCODE_KEY) !== null;
}

export function setPasscode(passcode: string): { ok: boolean; reason?: string } {
  if (!passcode || passcode.length < 4) {
    return { ok: false, reason: "Passcode must be at least 4 characters." };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, reason: "OS-level encryption isn't available on this machine — can't store a passcode safely." };
  }
  const encrypted = safeStorage.encryptString(passcode);
  repo.setSetting(PASSCODE_KEY, encrypted.toString("base64"));
  return { ok: true };
}

export function removePasscode(): void {
  repo.deleteSetting(PASSCODE_KEY);
}

export function verifyPasscode(attempt: string): boolean {
  const stored = repo.getSetting(PASSCODE_KEY);
  if (!stored) return true;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(stored, "base64"));
    return timingSafeEqual(decrypted, attempt);
  } catch {
    return false;
  }
}

export function getIdleTimeoutMinutes(defaultMinutes: number): number {
  const stored = repo.getSetting(IDLE_TIMEOUT_KEY);
  if (stored === null) return defaultMinutes;
  const n = Number(stored);
  return Number.isFinite(n) && n >= 0 ? n : defaultMinutes;
}

export function setIdleTimeoutMinutes(minutes: number): void {
  repo.setSetting(IDLE_TIMEOUT_KEY, String(Math.max(0, Math.round(minutes))));
}
