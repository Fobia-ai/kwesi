// Phase 13: forwards renderer-side crashes (an uncaught error during
// render, a rejected promise nobody caught) to the main process's
// local-only crash log (electron/logging/crashLog.ts -> KWESI_LOGS_DIR/
// crashes.log). No telemetry -- this never leaves the machine; it's purely
// so a bug report from a user has more to go on than "it went blank."

export interface RendererCrashReport {
  kind: "window-error" | "unhandledrejection";
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/**
 * Pure mapping from a `window.onerror`-shaped event to the report payload —
 * kept separate from the real `addEventListener("error", ...)` wiring so
 * it's testable without constructing a real DOM ErrorEvent.
 */
export function windowErrorToReport(event: {
  message?: string;
  error?: unknown;
  filename?: string;
  lineno?: number;
  colno?: number;
}): RendererCrashReport {
  const err = event.error;
  return {
    kind: "window-error",
    message: event.message || (err instanceof Error ? err.message : "Uncaught error"),
    stack: err instanceof Error ? err.stack : undefined,
    extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
  };
}

/**
 * Pure mapping from an `unhandledrejection` event's `reason` to the report
 * payload — same rationale as windowErrorToReport above.
 */
export function rejectionToReport(reason: unknown): RendererCrashReport {
  return {
    kind: "unhandledrejection",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  };
}

async function sendReport(report: RendererCrashReport): Promise<void> {
  if (window.kwesi?.crashLog) {
    try {
      await window.kwesi.crashLog.report(report.kind, report.message, report.stack, report.extra);
    } catch {
      // Crash reporting must never itself throw -- if the IPC call fails
      // there's nowhere further to escalate to.
    }
    return;
  }
  // Browser-preview dev (no Electron bridge, e.g. `vite` alone): nothing to
  // write to disk, so at least don't swallow it silently.
  console.error("[kwesi:crashLog]", report);
}

let installed = false;

/**
 * Installs `window.onerror`/`unhandledrejection` listeners that forward
 * renderer crashes to the local crash log. Call once, as early as possible
 * (see src/main.tsx), so it's armed before the rest of the app renders.
 */
export function installRendererCrashLogging(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    void sendReport(windowErrorToReport(event));
  });

  window.addEventListener("unhandledrejection", (event) => {
    void sendReport(rejectionToReport(event.reason));
  });
}
