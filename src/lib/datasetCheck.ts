import { useEffect, useMemo, useState } from "react";
import type { TrainingDatasetRequirements } from "../data/manifests";
import { formatDuration } from "./format";

/**
 * Checks a training dataset in the form, before a run starts, so a bad
 * dataset is flagged up front instead of failing minutes into a run.
 * Errors block the run; warnings explain something that will still work but
 * hurt the result.
 */

export type ClipStatus = "ok" | "empty" | "unreadable" | "unknown";

export interface ClipProbe {
  status: ClipStatus;
  durationSec: number | null;
}

export interface DatasetIssue {
  tone: "error" | "warning";
  message: string;
}

export interface DatasetCheckResult {
  totalSec: number;
  issues: DatasetIssue[];
  blocking: boolean;
}

// Chromium can't decode these, so their length can't be checked here --
// they're still valid for the training backends, which read them natively.
const UNPROBEABLE_EXTS = [".aiff", ".aif"];
const MIDI_EXTS = [".mid", ".midi"];

/** A MIDI file is checked by its "MThd" header; it has no audio length to measure. */
async function probeMidi(file: File): Promise<ClipProbe> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return { status: String.fromCharCode(...head) === "MThd" ? "ok" : "unreadable", durationSec: null };
  } catch {
    return { status: "unreadable", durationSec: null }; // moved, deleted or not permitted since it was picked
  }
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function names(files: { name: string }[], max = 3): string {
  const shown = files.slice(0, max).map((f) => f.name).join(", ");
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function validateDataset(
  files: { name: string }[],
  probes: (ClipProbe | undefined)[],
  req: TrainingDatasetRequirements,
): DatasetCheckResult {
  const issues: DatasetIssue[] = [];
  const at = (status: ClipStatus) => files.filter((_, i) => probes[i]?.status === status);
  const midi = req.fileTypes.length > 0 && req.fileTypes.every((t) => MIDI_EXTS.includes(t));

  if (files.length < req.minFiles) {
    issues.push({ tone: "error", message: `Needs at least ${plural(req.minFiles, midi ? "MIDI file" : "audio clip")} (have ${files.length}).` });
  }

  const empty = at("empty");
  if (empty.length > 0) issues.push({ tone: "error", message: `${names(empty)} ${empty.length === 1 ? "is" : "are"} empty.` });

  const unreadable = at("unreadable");
  if (unreadable.length > 0) {
    issues.push({
      tone: "error",
      message: `Couldn't read ${names(unreadable)} — ${unreadable.length === 1 ? "it may be" : "they may be"} corrupt or not really ${midi ? "MIDI" : "audio"}. Remove or re-export ${unreadable.length === 1 ? "it" : "them"}.`,
    });
  }

  const unknown = at("unknown");
  if (unknown.length > 0) {
    issues.push({
      tone: "warning",
      message: `Couldn't check the length of ${names(unknown)} (not previewable here). ${unknown.length === 1 ? "It" : "They"}'ll still be used.`,
    });
  }

  const durations = probes.map((p) => (p?.status === "ok" ? (p.durationSec ?? 0) : 0));
  const totalSec = durations.reduce((a, b) => a + b, 0);
  const minTotalSec = req.minTotalDurationMin * 60;
  if (minTotalSec > 0 && files.length > 0 && totalSec < minTotalSec) {
    const message = `Needs at least ${formatDuration(minTotalSec)} of audio in total (have ${formatDuration(totalSec)}).`;
    // With unmeasurable clips the real total may be fine, so don't block.
    issues.push({ tone: unknown.length > 0 ? "warning" : "error", message });
  }

  if (req.recommendedMinClipSec) {
    const short = files.filter((_, i) => probes[i]?.status === "ok" && durations[i] < req.recommendedMinClipSec!);
    if (short.length > 0) {
      issues.push({
        tone: "warning",
        message: `${plural(short.length, "clip")} ${short.length === 1 ? "is" : "are"} shorter than ${formatDuration(req.recommendedMinClipSec)}. ${req.shortClipReason ?? ""}`.trim(),
      });
    }
  }

  if (req.maxClipSec) {
    const long = files.filter((_, i) => probes[i]?.status === "ok" && durations[i] > req.maxClipSec!);
    if (long.length > 0) {
      issues.push({
        tone: "warning",
        message: `${plural(long.length, "clip")} ${long.length === 1 ? "is" : "are"} longer than ${formatDuration(req.maxClipSec)}. ${req.longClipReason ?? ""}`.trim(),
      });
    }
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const f of files) (seen.has(f.name) ? dupes : seen).add(f.name);
  if (dupes.size > 0) {
    issues.push({
      tone: "warning",
      message: `More than one file is named ${[...dupes].join(", ")}. ${req.requiresCaptions ? "Captions pair up by file name, so rename the duplicates." : "Rename the duplicates so each one is used."}`,
    });
  }

  return { totalSec, issues, blocking: issues.some((i) => i.tone === "error") };
}

const probeCache = new WeakMap<File, Promise<ClipProbe>>();

/** Reads a clip's duration from its metadata (no full decode), cached per File. */
export function probeClip(file: File): Promise<ClipProbe> {
  const cached = probeCache.get(file);
  if (cached) return cached;
  const probe: Promise<ClipProbe> =
    file.size === 0
      ? Promise.resolve({ status: "empty", durationSec: 0 })
      : MIDI_EXTS.includes(ext(file.name))
        ? probeMidi(file)
        : UNPROBEABLE_EXTS.includes(ext(file.name))
        ? Promise.resolve({ status: "unknown", durationSec: null })
        : new Promise((resolve) => {
            const url = URL.createObjectURL(file);
            const audio = new Audio();
            audio.preload = "metadata";
            const done = (result: ClipProbe) => {
              clearTimeout(timer);
              audio.removeAttribute("src");
              URL.revokeObjectURL(url);
              resolve(result);
            };
            const timer = setTimeout(() => done({ status: "unknown", durationSec: null }), 15_000);
            audio.onloadedmetadata = () =>
              done(Number.isFinite(audio.duration) ? { status: "ok", durationSec: audio.duration } : { status: "unknown", durationSec: null });
            audio.onerror = () => done({ status: "unreadable", durationSec: null });
            audio.src = url;
          });
  probeCache.set(file, probe);
  return probe;
}

/** Probes every file and validates the set; re-runs when the list changes. */
export function useDatasetCheck(files: File[], req: TrainingDatasetRequirements | undefined) {
  const [probes, setProbes] = useState<Map<File, ClipProbe>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // A probe that throws counts as unreadable -- one bad file must never
    // leave the whole check stuck on "checking…".
    const safeProbe = (f: File) =>
      probeClip(f).catch((): ClipProbe => ({ status: "unreadable", durationSec: null }));
    Promise.all(files.map(async (f) => [f, await safeProbe(f)] as const)).then((entries) => {
      if (!cancelled) setProbes(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  const checking = files.some((f) => !probes.has(f));
  const result = useMemo(
    () => (req ? validateDataset(files, files.map((f) => probes.get(f)), req) : null),
    [files, probes, req],
  );
  return { probes, checking, result };
}
