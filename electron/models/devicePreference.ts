import * as repo from "../db/repositories.js";

/**
 * Where generation runs: "auto" picks the best device each model supports
 * (NVIDIA GPU, then Apple's GPU, then the CPU); "cpu" keeps every model on
 * the CPU -- for machines whose GPU is only good for driving a display.
 * Set in Settings > System. Read when a model server starts, so a change
 * applies to the next server launch (the IPC handler stops idle servers).
 */
export type DevicePreference = "auto" | "cpu";

const DEVICE_PREFERENCE_KEY = "computeDevice";

export function getDevicePreference(): DevicePreference {
  return repo.getSetting(DEVICE_PREFERENCE_KEY) === "cpu" ? "cpu" : "auto";
}

export function setDevicePreference(preference: DevicePreference): void {
  repo.setSetting(DEVICE_PREFERENCE_KEY, preference === "cpu" ? "cpu" : "auto");
}

/**
 * Environment for a model server process. Pure, so it's testable.
 *
 * "cpu" is enforced three ways because the servers don't share one switch:
 * KWESI_DEVICE for Kwesi's own server.py files, ACESTEP_DEVICE for
 * ACE-Step's upstream server, and an empty CUDA_VISIBLE_DEVICES so anything
 * else built on PyTorch (fairseq under MuseCoco and Museformer) simply sees
 * no NVIDIA GPU.
 */
export function serverDeviceEnv(preference: DevicePreference, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const env: Record<string, string> = { KWESI_DEVICE: preference };
  if (preference === "cpu") {
    env.ACESTEP_DEVICE = "cpu";
    env.CUDA_VISIBLE_DEVICES = "";
  }
  // Metal doesn't implement every PyTorch operation; this lets the missing
  // ones run on the CPU instead of raising.
  if (platform === "darwin") env.PYTORCH_ENABLE_MPS_FALLBACK = "1";
  return env;
}
