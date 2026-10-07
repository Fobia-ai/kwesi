import { execFile, execFileSync } from "node:child_process";
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
    // "apple": Apple silicon's built-in GPU, which shares system memory, so
    // its total/used/free are the machine's RAM figures.
    kind: "nvidia" | "apple" | "none";
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
/**
 * Free + inactive + speculative pages from `vm_stat`: what macOS can hand
 * out without swapping. os.freemem() there counts only the truly idle pages
 * and reads as nearly full on a healthy machine.
 */
export function parseVmStatAvailableBytes(output: string): number | null {
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (label: string) => Number(output.match(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m"))?.[1]);
  const free = pages("Pages free");
  const inactive = pages("Pages inactive");
  if (!Number.isFinite(pageSize) || !Number.isFinite(free) || !Number.isFinite(inactive)) return null;
  const speculative = pages("Pages speculative");
  return (free + inactive + (Number.isFinite(speculative) ? speculative : 0)) * pageSize;
}

function availableRamBytes(): number {
  if (process.platform === "darwin") {
    try {
      const parsed = parseVmStatAvailableBytes(execFileSync("vm_stat", { encoding: "utf8", timeout: 2000 }));
      if (parsed !== null) return parsed;
    } catch {
      // fall through to os.freemem()
    }
  }
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
  const noGpu = { available: false, kind: "none" as const, totalVramGb: 0, usedVramGb: 0, freeVramGb: 0, utilizationPct: null };

  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      gpu: {
        available: true,
        kind: "apple",
        name: "Apple GPU (Metal)",
        totalVramGb: ram.totalGb,
        usedVramGb: ram.totalGb - ram.freeGb,
        freeVramGb: ram.freeGb,
        utilizationPct: null,
      },
      ram,
    };
  }

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
      kind: "nvidia",
      name: parts[0],
      totalVramGb: totalMb / 1024,
      usedVramGb: usedMb / 1024,
      freeVramGb: Math.max(0, totalMb - usedMb) / 1024,
      utilizationPct: Number.isFinite(utilization) ? utilization : null,
    },
    ram,
  };
}
