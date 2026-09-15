import { execFile } from "node:child_process";

export interface GpuVramInfo {
  available: boolean;
  totalVramGb: number;
  freeVramGb: number;
  gpuName?: string;
}

const NO_GPU: GpuVramInfo = { available: false, totalVramGb: 0, freeVramGb: 0 };

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Real GPU VRAM query via `nvidia-smi`, the simplest reliable
 * cross-distro way to get live free/total VRAM without a native addon or a
 * CUDA runtime dependency in the Electron main process itself. Any failure
 * (no `nvidia-smi` on PATH, no NVIDIA driver, timeout, unparsable output) is
 * treated as "no GPU detected" rather than thrown — this machine always has
 * one, but plenty of machines this app runs on won't, and hardware gating
 * has to degrade gracefully rather than crash the generation form.
 */
export async function queryGpuVram(): Promise<GpuVramInfo> {
  let stdout: string;
  try {
    stdout = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
      3000,
    );
  } catch {
    return NO_GPU;
  }

  const firstLine = stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return NO_GPU;

  const parts = firstLine.split(",").map((p) => p.trim());
  if (parts.length < 3) return NO_GPU;

  const [gpuName, totalStr, usedStr] = parts;
  const totalMb = Number(totalStr);
  const usedMb = Number(usedStr);
  if (!Number.isFinite(totalMb) || !Number.isFinite(usedMb)) return NO_GPU;

  const freeMb = Math.max(0, totalMb - usedMb);
  return {
    available: true,
    totalVramGb: totalMb / 1024,
    freeVramGb: freeMb / 1024,
    gpuName,
  };
}
