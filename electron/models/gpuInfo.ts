import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

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

export interface SystemResources {
  gpu: {
    available: boolean;
    name?: string;
    totalVramGb: number;
    usedVramGb: number;
    freeVramGb: number;
    // How busy the GPU is, 0-100; null when the driver doesn't report it.
    utilizationPct: number | null;
  };
  ram: { totalGb: number; freeGb: number };
}

const GB = 1024 ** 3;

/**
 * Memory that can actually be handed to a new process. On Linux that's
 * MemAvailable, not os.freemem(): the latter leaves out the page cache,
 * which the kernel gives back on demand, so a machine with plenty of room
 * would look almost full.
 */
function availableRamBytes(): number {
  if (process.platform === "linux") {
    try {
      const match = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (match) return Number(match[1]) * 1024;
    } catch {
      // fall through to os.freemem()
    }
  }
  return os.freemem();
}

/**
 * A live snapshot for the resource card: GPU memory and load, plus system
 * memory. Like queryGpuVram, a machine without a working nvidia-smi simply
 * reports no GPU.
 */
export async function querySystemResources(): Promise<SystemResources> {
  const ram = { totalGb: os.totalmem() / GB, freeGb: availableRamBytes() / GB };
  const noGpu = { available: false, totalVramGb: 0, usedVramGb: 0, freeVramGb: 0, utilizationPct: null };

  let stdout: string;
  try {
    stdout = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
      3000,
    );
  } catch {
    return { gpu: noGpu, ram };
  }

  const firstLine = stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  const parts = firstLine?.split(",").map((p) => p.trim()) ?? [];
  const totalMb = Number(parts[1]);
  const usedMb = Number(parts[2]);
  if (parts.length < 3 || !Number.isFinite(totalMb) || !Number.isFinite(usedMb)) return { gpu: noGpu, ram };

  const utilization = Number(parts[3]);
  return {
    gpu: {
      available: true,
      name: parts[0],
      totalVramGb: totalMb / 1024,
      usedVramGb: usedMb / 1024,
      freeVramGb: Math.max(0, totalMb - usedMb) / 1024,
      utilizationPct: Number.isFinite(utilization) ? utilization : null,
    },
    ram,
  };
}
