import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { minVramGbFor, type ManifestInput, type ModelManifest } from "../../data/manifests";
import { LANGUAGES } from "../../data/languages";
import { kwesiHardware, type GpuVramInfo } from "../../lib/hardware";
import type { ArtistProfile } from "../../lib/artistProfiles";
import { PillButton } from "../ui/PillButton";
import { EmptyState } from "../ui/EmptyState";
import { AvatarImage } from "../ui/AvatarImage";
import { ChipMultiSelect } from "../ui/ChipMultiSelect";
import { ModelsIcon } from "../ui/icons";

export type GenerationFormValues = Record<string, unknown>;

interface DynamicGenerationFormProps {
  manifest: ModelManifest;
  installedVariantNames: string[];
  // Phase 10: trained-model variant names for this model family (already
  // guaranteed installed — see trainingManager.ts) that aren't part of the
  // manifest's static `checkpointVariants` list. Merged in separately
  // rather than folded into that static array, since it's runtime data
  // (WorkspaceDetail.tsx derives it from `model_variant` rows where
  // `source === "trained"`), not catalog data.
  extraVariantNames?: string[];
  // Every generation is required to be attributed to one of these — see
  // Settings.tsx's Artists tab for where they're managed.
  artistProfiles: ArtistProfile[];
  disabled?: boolean;
  onSubmit: (checkpointVariant: string | null, values: GenerationFormValues) => void;
}

export function visibleInputs(inputs: ManifestInput[], selectedVariant: string | null): ManifestInput[] {
  return inputs.filter((input) => !input.onlyForVariant || input.onlyForVariant === selectedVariant);
}

/**
 * Real absolute path when running inside Electron (32+'s webUtils.getPathForFile
 * bridge, exposed as window.kwesi.getFilePathForUpload — see electron/preload.ts),
 * falling back to just the picked file's name in the plain-browser preview mock
 * where window.kwesi is undefined and there's no real filesystem to resolve
 * against. This used to only ever capture the name (a known gap since Phase 4,
 * documented in kwesi.docs/04-roadmap.md's Phase 5/7 notes) — RAVE's audio_upload
 * input is what makes fixing it non-optional, since RAVE has nothing to run
 * without a real transferred path.
 */
function resolveUploadedFilePath(file: File | undefined): string {
  if (!file) return "";
  const realPath = window.kwesi?.getFilePathForUpload(file);
  return realPath && realPath.length > 0 ? realPath : file.name;
}

export function defaultValueFor(input: ManifestInput): unknown {
  if ("default" in input && input.default !== undefined) return input.default;
  if (input.type === "number") return "";
  if (input.type === "multiselect") return [];
  return "";
}

export function isSatisfied(input: ManifestInput, value: unknown): boolean {
  if (!input.required) return true;
  if (input.type === "audio_upload" || input.type === "midi_upload") return typeof value === "string" && value.length > 0;
  if (input.type === "multiselect") return Array.isArray(value) && value.length > 0;
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

/**
 * The single control-level renderer for every manifest input type — reused
 * as-is by the Training screen's hyperparameters form (Phase 10) so
 * `training.hyperparameters[]` (same `ManifestInput[]` shape as generation's
 * `inputs[]`) renders through the exact same field controls rather than a
 * second form system, per kwesi.docs/02-architecture.md's "Manifest
 * extension: training" — this is the "generalize it slightly" the roadmap
 * asked for: export the reusable pieces rather than forking them.
 */
export function FieldControl({
  input,
  value,
  onChange,
}: {
  input: ManifestInput;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (input.type) {
    case "text":
      return (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "textarea":
      return (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder}
          rows={3}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={(value as string | number) ?? ""}
          min={input.min}
          max={input.max}
          step={input.step ?? 1}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "select":
      return (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="" disabled>
            Select…
          </option>
          {input.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const selected = (value as string[] | undefined) ?? [];
      return (
        <ChipMultiSelect
          options={input.options}
          selected={selected}
          onToggle={(optionValue) =>
            onChange(
              selected.includes(optionValue)
                ? selected.filter((v) => v !== optionValue)
                : [...selected, optionValue],
            )
          }
        />
      );
    }
    case "tags":
      return (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder ?? "comma-separated"}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      );
    case "audio_upload":
    case "midi_upload":
      return (
        <input
          type="file"
          accept={input.accept}
          onChange={(e) => onChange(resolveUploadedFilePath(e.target.files?.[0]))}
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-xs outline-none file:mr-2 file:rounded-chip file:border-0 file:bg-ink/[0.08] file:px-3 file:py-1 file:text-xs"
        />
      );
    default:
      return null;
  }
}

export type HardwareGateStatus =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "block"; message: string };

/**
 * Phase 8 hardware-gating: compares the selected variant's real VRAM
 * requirement against this machine's live free VRAM (queried once per
 * mount, not re-queried per keystroke — free VRAM doesn't change from
 * typing in a text field). A hard block is reserved for the one case a
 * generation is *guaranteed* to fail outright — no GPU detected at all and
 * the model has no CPU fallback path — since every other shortfall is only
 * an estimate: `minVramGb` is a documented minimum, not a live guarantee,
 * and other GPU memory can free up between now and when the job actually
 * runs. Warning (not blocking) in the uncertain cases respects the user's
 * own judgment about their hardware, per the roadmap's explicit guidance.
 */
export function evaluateHardwareGate(
  target: { displayName: string; hardware: { cpuFallback: boolean } },
  requiredVramGb: number,
  gpu: GpuVramInfo | null,
): HardwareGateStatus {
  if (!gpu) return { level: "ok" };
  if (requiredVramGb <= 0) return { level: "ok" };

  if (!gpu.available) {
    if (!target.hardware.cpuFallback) {
      return {
        level: "block",
        message: `${target.displayName} requires an NVIDIA GPU with ~${requiredVramGb}GB+ VRAM and has no CPU fallback — no GPU was detected on this machine.`,
      };
    }
    return {
      level: "warn",
      message: "No GPU detected — generation will run on CPU, which is much slower than the GPU path this model normally uses.",
    };
  }

  if (gpu.freeVramGb < requiredVramGb) {
    return {
      level: "warn",
      message: `This checkpoint needs about ${requiredVramGb}GB of VRAM; only ~${gpu.freeVramGb.toFixed(1)}GB is currently free on your GPU (${gpu.gpuName ?? "detected GPU"}). Generation may fail or run much slower than expected.`,
    };
  }

  return { level: "ok" };
}

export function HardwareGateBanner({ status }: { status: HardwareGateStatus }) {
  if (status.level === "ok") return null;
  const isBlock = status.level === "block";
  return (
    <div
      role="alert"
      className={`rounded-[10px] border px-3 py-2 text-xs ${
        isBlock
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
    >
      {isBlock ? "Hardware requirement not met: " : "Hardware warning: "}
      {status.message}
    </div>
  );
}

export function DynamicGenerationForm({
  manifest,
  installedVariantNames,
  extraVariantNames,
  artistProfiles,
  disabled,
  onSubmit,
}: DynamicGenerationFormProps) {
  const navigate = useNavigate();

  const usableVariants = useMemo(() => {
    const fromManifest = manifest.checkpointVariants.filter((v) => installedVariantNames.includes(v));
    const extra = (extraVariantNames ?? []).filter((v) => !fromManifest.includes(v));
    return [...fromManifest, ...extra];
  }, [manifest.checkpointVariants, installedVariantNames, extraVariantNames]);

  const [selectedVariant, setSelectedVariant] = useState<string>(usableVariants[0] ?? "");
  const [values, setValues] = useState<GenerationFormValues>(() => {
    // `music_name`, `artist_profile_id`, and `artist_genres` are generic,
    // fields every generation gets regardless of model — not part of any
    // manifest's `inputs[]` (those are per-model parameters), so they're
    // seeded here rather than in the loop below. music_name is what
    // generations are actually titled by throughout the app; the profile
    // and genres are shown alongside it (WorkspaceDetail's list/detail
    // panes). artist_genres starts as the selected artist's full genre set
    // — the effect below re-seeds it whenever the artist selection changes.
    const initial: GenerationFormValues = {
      music_name: "",
      artist_profile_id: artistProfiles[0]?.id ?? "",
      artist_genres: [...(artistProfiles[0]?.genres ?? [])],
    };
    for (const input of manifest.inputs) initial[input.key] = defaultValueFor(input);
    return initial;
  });
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    kwesiHardware.gpuVram().then((info) => {
      if (!cancelled) setGpu(info);
    });
    return () => {
      cancelled = true;
    };
    // Queried once per mount — free VRAM doesn't meaningfully change while
    // this form is open, and re-querying per variant/field change would
    // just be extra nvidia-smi calls for no real benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const artist = artistProfiles.find((p) => p.id === values.artist_profile_id);
    const artistGenres = artist ? [...artist.genres] : [];
    setValues((prev) => {
      const next: GenerationFormValues = { ...prev, artist_genres: artistGenres };
      // Also seeds the model's own genre-conditioning field (if it has one
      // — MuseCoco's `genre`, ACE-Step's `genre_tags`, YuE2's `style_genre`)
      // from the same artist genres, so the user doesn't have to re-enter
      // genres they already set on the artist. A multiselect only pre-checks
      // options that actually map to one of the artist's genres
      // (autoSelectFromAppGenres); a free-text "tags" field gets them joined
      // as a starting point. Either way this only runs when the artist
      // changes, not on every edit, so the user's own edits afterward stick.
      const genreField = manifest.inputs.find((input) => input.isModelGenreField);
      if (genreField) {
        if (genreField.type === "multiselect") {
          const map = genreField.autoSelectFromAppGenres ?? {};
          next[genreField.key] = genreField.options
            .map((opt) => opt.value)
            .filter((value) => (map[value] ?? []).some((g) => artistGenres.includes(g)));
        } else {
          next[genreField.key] = artistGenres.join(", ");
        }
      }
      // Same idea for the model's own language field (ACE-Step's
      // vocal_language select, YuE2's free-text hint), seeded from the
      // artist's primary (first) language — but only when the artist
      // actually declares one. Unlike genre's multiselect, where "nothing
      // selected" is a perfectly valid state to reset to, a select field has
      // no sensible empty value and a free-text hint shouldn't get blanked
      // out just because this particular artist has no language set, so an
      // artist with no languages simply leaves whatever was there before.
      const languageField = manifest.inputs.find((input) => input.isModelLanguageField);
      if (languageField && artist && artist.languages.length > 0) {
        const primaryCode = artist.languages[0];
        next[languageField.key] =
          languageField.type === "select" ? primaryCode : (LANGUAGES.find((l) => l.code === primaryCode)?.name ?? primaryCode);
      }
      return next;
    });
    // Re-seeds whenever the artist changes — the previous artist's genres
    // wouldn't apply. Keyed only on the id (not artistProfiles/manifest,
    // stable references per render) so this doesn't re-fire on unrelated
    // re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.artist_profile_id]);

  if (manifest.checkpointVariants.length === 0) {
    return (
      <EmptyState
        icon={<ModelsIcon width={24} height={24} />}
        title="No trained model available yet for this model family."
      />
    );
  }

  if (usableVariants.length === 0) {
    return (
      <EmptyState
        icon={<ModelsIcon width={24} height={24} />}
        title={`No installed checkpoint for ${manifest.displayName} yet.`}
        action={<PillButton onClick={() => navigate("/models")}>Open Model Manager</PillButton>}
      />
    );
  }

  if (artistProfiles.length === 0) {
    return (
      <EmptyState
        icon={<ModelsIcon width={24} height={24} />}
        title="No artist profiles yet — every generation needs one."
        action={<PillButton onClick={() => navigate("/settings")}>Create one in Settings</PillButton>}
      />
    );
  }

  const shown = visibleInputs(manifest.inputs, selectedVariant);
  const missingMusicName = !String(values.music_name ?? "").trim();
  const missingArtistProfile = !String(values.artist_profile_id ?? "").trim();
  const missingRequired =
    missingMusicName || missingArtistProfile || shown.some((input) => !isSatisfied(input, values[input.key]));
  const selectedArtistProfile = artistProfiles.find((p) => p.id === values.artist_profile_id) ?? null;
  const requiredVramGb = minVramGbFor(manifest, selectedVariant || null);
  const hardwareGate = evaluateHardwareGate(manifest, requiredVramGb, gpu);

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleGenre(genre: string) {
    setValues((prev) => {
      const current = (prev.artist_genres as string[]) ?? [];
      const next = current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre];
      return { ...prev, artist_genres: next };
    });
  }

  /**
   * A cleared optional "number" field holds the literal string "" (see
   * FieldControl's number case) so the input can render empty — but a
   * couple of real servers do an unguarded `int(x)`/numeric compare on
   * whatever they're sent (MuseCoco's bar_bucket/tempo_bucket, confirmed by
   * reading servers/musecoco/server.py directly), which throws on `""`
   * rather than treating it as "not set". Normalizing every number field's
   * "" to `null` right before submit fixes this generically for every
   * model's optional number fields, not just MuseCoco's.
   */
  function normalizeForSubmit(raw: GenerationFormValues): GenerationFormValues {
    const next = { ...raw };
    for (const input of manifest.inputs) {
      if (input.type === "number" && next[input.key] === "") next[input.key] = null;
    }
    return next;
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        Music name
        <span className="text-red-500"> *</span>
        <input
          value={(values.music_name as string) ?? ""}
          onChange={(e) => setValue("music_name", e.target.value)}
          placeholder="e.g. Midnight Drive"
          className="kwesi-glass w-full rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        Artist profile
        <span className="text-red-500"> *</span>
        <div className="flex items-center gap-2">
          {selectedArtistProfile && (
            <AvatarImage avatarPath={selectedArtistProfile.avatarPath} name={selectedArtistProfile.name} size={28} />
          )}
          <select
            value={(values.artist_profile_id as string) ?? ""}
            onChange={(e) => setValue("artist_profile_id", e.target.value)}
            className="kwesi-glass min-w-0 flex-1 rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          >
            {artistProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </label>

      {selectedArtistProfile && selectedArtistProfile.genres.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0 text-sm">
          <legend className="p-0 text-sm">Genres for this track</legend>
          <p className="text-xs text-ink-muted">
            From {selectedArtistProfile.name}'s genres — optional, defaults to all of them.
          </p>
          <ChipMultiSelect
            options={selectedArtistProfile.genres}
            selected={(values.artist_genres as string[]) ?? []}
            onToggle={toggleGenre}
          />
        </fieldset>
      )}

      {usableVariants.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          Checkpoint variant
          <select
            value={selectedVariant}
            onChange={(e) => setSelectedVariant(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          >
            {usableVariants.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      {shown.map((input) => {
        const control = (
          <FieldControl input={input} value={values[input.key]} onChange={(v) => setValue(input.key, v)} />
        );
        const help = input.helpText && <span className="text-xs text-ink-muted">{input.helpText}</span>;
        const requiredMark = input.required && <span className="text-red-500"> *</span>;
        // A multiselect renders several independent buttons, not one form
        // control — wrapping that in <label> (fine for a single input/
        // select) makes each button's own accessible name ambiguous, since
        // implicit label association pulls in the surrounding label text.
        // <fieldset>/<legend> is the correct grouping semantics for that
        // case instead.
        if (input.type === "multiselect") {
          return (
            <fieldset key={input.key} className="m-0 flex flex-col gap-1.5 border-0 p-0 text-sm">
              <legend className="p-0 text-sm">
                {input.label}
                {requiredMark}
              </legend>
              {control}
              {help}
            </fieldset>
          );
        }
        return (
          <label key={input.key} className="flex flex-col gap-1.5 text-sm">
            {input.label}
            {requiredMark}
            {control}
            {help}
          </label>
        );
      })}

      <HardwareGateBanner status={hardwareGate} />

      <div className="mt-2 flex justify-end">
        <PillButton
          disabled={disabled || missingRequired || hardwareGate.level === "block"}
          onClick={() => onSubmit(selectedVariant || null, normalizeForSubmit(values))}
        >
          Generate
        </PillButton>
      </div>
    </div>
  );
}
