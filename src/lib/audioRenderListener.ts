import { renderMidiToWav } from "./midiToAudio";

/**
 * Installed once at app boot (see main.tsx, right alongside
 * installRendererCrashLogging -- same "one global listener, not a mounted
 * component" convention), not per-screen: a MIDI->audio render request can
 * arrive from the main process at any time a generation completes,
 * regardless of which screen is currently showing. No-ops in the
 * browser-preview dev mock (window.kwesi is undefined there — no main
 * process to receive requests from).
 */
export function installAudioRenderListener() {
  if (!window.kwesi?.audioRender) return;
  const audioRender = window.kwesi.audioRender;
  audioRender.onRequest(async ({ requestId, midiPath }) => {
    try {
      const wavBytes = await renderMidiToWav(midiPath);
      audioRender.respond({ requestId, ok: true, wavBytes });
    } catch (err) {
      audioRender.respond({ requestId, ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
  });
}
