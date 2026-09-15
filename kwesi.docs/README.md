# Kwesi — Planning Docs

Kwesi is a desktop music-generation application that wraps multiple open-source
music generation models behind one consistent, dynamically-adapting UI. A user
picks a model, and the app reconfigures its input form and output viewer to
match exactly what that model takes in and produces — text prompt, MIDI
piano-roll, waveform player, whatever fits.

No accounts, no sign-up. First launch shows an acknowledgments screen crediting
every paper/org whose model is bundled, then the user is straight into the app.
An optional local passcode can lock the app afterward, and a local-only
profile (name/email) lives in Settings.

Beyond generation, most catalog models are foundation models the user can
**train on their own music** — a dedicated Training pipeline (drop in your
own audio/MIDI, configure, run, choose an output folder) turns the result
into a custom checkpoint usable in any new workspace.

## Reading order

1. [01-overview.md](01-overview.md) — product vision, core concepts, what's confirmed vs. still open
2. [02-architecture.md](02-architecture.md) — tech stack, app shell, data model, the model-adapter plugin system
3. [03-model-catalog.md](03-model-catalog.md) — every target model, its real identity, inputs/outputs, license, hardware needs
4. [04-roadmap.md](04-roadmap.md) — the phased build plan (the actual thing we execute against)

## Status

- UI reference basis: `referenceImages/` (Voicebox-style app + an Invoke-style Model Manager) for **structural/layout** patterns only — icon rail, card lists, bottom generation bar, chained dropdowns, install queue. The actual **visual skin** is glassmorphic, Apple/iOS-style (translucent blurred panels, light/dark adaptive, one restrained accent color, smooth motion) — see [02-architecture.md](02-architecture.md). More references may be added — re-check this folder before starting Phase 1 in case new images landed.
- Stack **confirmed**: Electron + React + local Python sidecar servers per model, one isolated venv per model. See [02-architecture.md](02-architecture.md) for the Tauri comparison and rationale.
- App lock **confirmed**: relaunch + idle-timeout (default 10 min, configurable).
- All data directories are **environment-variable-driven** with sensible defaults (`KWESI_HOME`, `KWESI_MODELS_DIR`, `KWESI_EXPORTS_DIR`, etc.) — see [02-architecture.md](02-architecture.md).
- Model catalog is researched and cross-checked against real repos (Sept 2026); a few dependency/output-format details are flagged `NEEDS VERIFICATION` per model and should be re-confirmed against the actual repo at integration time, not just trusted from this doc.
- No open decisions currently blocking Phase 1.
