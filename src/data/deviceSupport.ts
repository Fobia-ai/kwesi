import { MANIFESTS } from "./manifests";

/**
 * Which device each model can generate on -- the table in Settings > About
 * and the README's "Which device a model runs on". `level` drives the cell's
 * colour; `note` is the caveat shown under it.
 *
 * Keep in step with the servers' own device selection (servers/<model>/
 * server.py's pick_device, ACE-Step's upstream ACESTEP_DEVICE) and with
 * `hardware.appleGpu` / `hardware.cpuFallback` in manifests.ts.
 */
export type SupportLevel = "yes" | "partial" | "no" | "na";

export interface DeviceCell {
  level: SupportLevel;
  label: string;
  note?: string;
}

export interface DeviceSupportRow {
  modelId: string;
  nvidia: DeviceCell;
  apple: DeviceCell;
  cpu: DeviceCell;
}

export const DEVICE_SUPPORT: DeviceSupportRow[] = [
  {
    modelId: "ace-step-1.5",
    nvidia: { level: "yes", label: "Yes" },
    apple: { level: "yes", label: "Yes", note: "Supported by ACE-Step itself" },
    cpu: { level: "partial", label: "Slow" },
  },
  {
    modelId: "musicgen",
    nvidia: { level: "yes", label: "Yes" },
    apple: { level: "partial", label: "Tried first", note: "Falls back to the CPU if Metal fails" },
    cpu: { level: "partial", label: "Slow" },
  },
  {
    modelId: "yue2",
    nvidia: { level: "yes", label: "Yes" },
    apple: { level: "no", label: "No", note: "YuE2 is Linux-only" },
    cpu: { level: "partial", label: "Unverified" },
  },
  {
    modelId: "musecoco",
    nvidia: { level: "yes", label: "Yes", note: "With GPU acceleration built" },
    apple: { level: "no", label: "No" },
    cpu: { level: "yes", label: "Yes" },
  },
  {
    modelId: "museformer",
    nvidia: { level: "yes", label: "Yes" },
    apple: { level: "no", label: "No" },
    cpu: { level: "yes", label: "Yes" },
  },
  {
    modelId: "rave",
    nvidia: { level: "na", label: "Not needed" },
    apple: { level: "na", label: "Not needed" },
    cpu: { level: "yes", label: "Yes", note: "Fast" },
  },
];

export function deviceSupportRows(): (DeviceSupportRow & { displayName: string })[] {
  return DEVICE_SUPPORT.map((row) => ({ ...row, displayName: MANIFESTS[row.modelId]?.displayName ?? row.modelId }));
}
