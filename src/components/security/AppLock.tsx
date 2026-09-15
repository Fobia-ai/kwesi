import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LockScreen } from "./LockScreen";
import { kwesiSecurity } from "../../lib/security";
import { useIdleTimer } from "../../lib/useIdleTimer";

interface AppLockContextValue {
  /** Call after Settings changes the passcode or idle timeout so the
   * currently-running session picks it up immediately, not just on next
   * relaunch — e.g. setting a passcode for the first time should start
   * idle-locking in this same session. */
  refreshLockSettings: () => void;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within AppLock");
  return ctx;
}

type ReadyState = "checking" | "ready";

/**
 * Wraps the whole app. Children stay mounted underneath even while locked
 * (LockScreen is a full-screen overlay, not a route swap) so unlocking
 * returns to exactly where the user left off — in-progress form state,
 * scroll position, current route, all untouched.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<ReadyState>("checking");
  const [hasPasscode, setHasPasscode] = useState(false);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(10);
  const [locked, setLocked] = useState(false);

  const loadLockSettings = useCallback(async () => {
    const [passcodeSet, minutes] = await Promise.all([
      kwesiSecurity.hasPasscode(),
      kwesiSecurity.getIdleTimeoutMinutes(),
    ]);
    setHasPasscode(passcodeSet);
    setIdleTimeoutMinutes(minutes);
    return passcodeSet;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLockSettings().then((passcodeSet) => {
      if (cancelled) return;
      setLocked(passcodeSet);
      setReady("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [loadLockSettings]);

  const refreshLockSettings = useCallback(() => {
    void loadLockSettings();
  }, [loadLockSettings]);

  useIdleTimer(idleTimeoutMinutes, hasPasscode && !locked, () => setLocked(true));

  if (ready === "checking") return null;

  return (
    <AppLockContext.Provider value={{ refreshLockSettings }}>
      {children}
      {locked && <LockScreen onUnlocked={() => setLocked(false)} />}
    </AppLockContext.Provider>
  );
}
