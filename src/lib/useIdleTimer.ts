import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Calls onIdle after `timeoutMinutes` of no mouse/keyboard/scroll activity.
 * `enabled: false` (no passcode set, or already locked) tears the listeners
 * down entirely rather than just skipping the callback, so a locked app
 * isn't still paying for activity-event churn it can't act on.
 */
export function useIdleTimer(timeoutMinutes: number, enabled: boolean, onIdle: () => void): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || timeoutMinutes <= 0) return;

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMinutes * 60_000);
    }

    reset();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, reset, { passive: true });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, reset);
    };
  }, [enabled, timeoutMinutes]);
}
