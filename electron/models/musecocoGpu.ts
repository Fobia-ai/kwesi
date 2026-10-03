/**
 * Optional GPU build of MuseCoco's attention kernel, offered from the
 * Training screen (not the install or generation flow).
 *
 * MuseCoco's linear attention runs through pytorch-fast-transformers'
 * compiled `causal_product` extension. A normal install builds it CPU-only,
 * because compiling the CUDA half needs an `nvcc` matching torch 1.11's
 * CUDA 11.3 plus a host compiler old enough for it -- which almost no
 * machine has. This builds exactly that toolchain, deterministically, from
 * servers/musecoco/cuda-toolchain.lock (every package pinned by URL + md5)
 * using a pinned, checksummed micromamba; compiles the extension into a
 * staging dir; checks the new CUDA kernel against the CPU one on the real
 * GPU; and only then swaps it into the venv. The toolchain (~1GB) is
 * deleted afterwards either way -- the built kernel only links against
 * torch's own libraries.
 *
 * Measured on an RTX 3090: training ~50s -> ~1s per update, generation
 * 18min -> 23s. servers/musecoco/server.py and runMuseCocoTrainingPipeline
 * both detect the kernel and use the GPU on their own once it exists.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serversRootDir, venvDir, venvsRootDir } from "../db/paths.js";
import { runCommand, type OnOutput } from "./envInstaller.js";
import { queryGpuVram } from "./gpuInfo.js";

const MICROMAMBA_VERSION = "2.9.0-0";
const MICROMAMBA_URL = `https://github.com/mamba-org/micromamba-releases/releases/download/${MICROMAMBA_VERSION}/micromamba-linux-64`;
const MICROMAMBA_SHA256 = "366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3";

const FAST_TRANSFORMERS = "pytorch-fast-transformers==0.4.0";
// Every GPU generation CUDA 11.3 can target (Pascal through Ampere), plus
// PTX so newer cards JIT-compile the kernel on first use.
const CUDA_ARCH_LIST = "6.0;6.1;7.0;7.5;8.0;8.6+PTX";

// Imports the freshly built package from the staging dir (PYTHONPATH wins
// over site-packages) and checks the CUDA kernel against the CPU kernel.
const VERIFY_SCRIPT = `
import os, sys, torch
import fast_transformers
from fast_transformers.causal_product import causal_dot_product, causal_dot_product_cuda
staged = os.environ["KWESI_STAGED"]
assert fast_transformers.__file__.startswith(staged), "imported the old build, not the new one"
assert causal_dot_product_cuda is not None, "the build has no CUDA kernel"
torch.manual_seed(0)
q, k, v = [torch.rand(1, 4, 256, 32) for _ in range(3)]
cpu = causal_dot_product(q, k, v)
gpu = causal_dot_product(q.cuda(), k.cuda(), v.cuda()).cpu()
err = float((gpu - cpu).abs().max() / cpu.abs().max())
assert err < 1e-4, f"GPU kernel disagrees with the CPU kernel (relative error {err})"
print(f"GPU kernel matches the CPU kernel (relative error {err:.1e})")
`;

export interface MusecocoGpuStatus {
  supported: boolean;
  built: boolean;
  reason?: string;
}

function musecocoPython(): string {
  return path.join(venvDir("musecoco"), "bin", "python");
}

function sitePackagesDir(): string | null {
  const lib = path.join(venvDir("musecoco"), "lib");
  if (!fs.existsSync(lib)) return null;
  const py = fs.readdirSync(lib).find((d) => d.startsWith("python"));
  return py ? path.join(lib, py, "site-packages") : null;
}

/** True once the venv's fast-transformers has its CUDA causal_product kernel. */
export function musecocoCudaKernelBuilt(): boolean {
  const sitePackages = sitePackagesDir();
  if (!sitePackages) return false;
  const dir = path.join(sitePackages, "fast_transformers", "causal_product");
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith("causal_product_cuda") && f.endsWith(".so"));
}

export async function checkMusecocoGpuStatus(): Promise<MusecocoGpuStatus> {
  const built = musecocoCudaKernelBuilt();
  if (process.platform !== "linux" || process.arch !== "x64") {
    return { supported: false, built, reason: "GPU acceleration for MuseCoco can only be built on Linux (x86-64)." };
  }
  if (!(await queryGpuVram()).available) {
    return { supported: false, built, reason: "No NVIDIA GPU detected (nvidia-smi didn't respond)." };
  }
  if (!fs.existsSync(musecocoPython())) {
    return { supported: false, built, reason: "Set up MuseCoco's training environment first." };
  }
  return { supported: true, built };
}

async function downloadMicromamba(dest: string, onOutput: OnOutput): Promise<void> {
  onOutput(`Downloading micromamba ${MICROMAMBA_VERSION}…`);
  const res = await fetch(MICROMAMBA_URL);
  if (!res.ok) throw new Error(`Downloading micromamba failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== MICROMAMBA_SHA256) throw new Error(`micromamba checksum mismatch (got ${sha})`);
  fs.writeFileSync(dest, bytes, { mode: 0o755 });
}

/** Swaps the verified staged package into the venv, replacing the CPU-only build. */
function installStaged(staged: string): void {
  const sitePackages = sitePackagesDir();
  if (!sitePackages) throw new Error("MuseCoco's venv has no site-packages directory");
  for (const entry of fs.readdirSync(sitePackages)) {
    if (entry.startsWith("pytorch_fast_transformers-") && entry.endsWith(".dist-info")) {
      fs.rmSync(path.join(sitePackages, entry), { recursive: true, force: true });
    }
  }
  for (const entry of fs.readdirSync(staged)) {
    if (entry === "bin") continue;
    const target = path.join(sitePackages, entry);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(staged, entry), target, { recursive: true });
  }
}

export async function buildMusecocoGpuKernel(onOutput: OnOutput): Promise<{ ok: boolean; reason?: string }> {
  const status = await checkMusecocoGpuStatus();
  if (!status.supported) return { ok: false, reason: status.reason };

  const python = musecocoPython();
  const work = path.join(venvsRootDir(), ".build", "musecoco-gpu");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const micromamba = path.join(work, "micromamba");
    await downloadMicromamba(micromamba, onOutput);

    const toolchain = path.join(work, "toolchain");
    onOutput("Installing the pinned CUDA 11.3 build toolchain (~1GB, removed when done)…");
    await runCommand(
      micromamba,
      ["create", "-y", "-p", toolchain, "--file", path.join(serversRootDir(), "musecoco", "cuda-toolchain.lock")],
      { env: { ...process.env, MAMBA_ROOT_PREFIX: path.join(work, "mamba-root") }, onOutput },
    );

    // --no-build-isolation builds against the venv's own torch, which needs
    // setuptools/wheel in the venv itself.
    await runCommand("uv", ["pip", "install", "--python", python, "setuptools<70", "wheel"], { onOutput });

    const staged = path.join(work, "staged");
    const bin = path.join(toolchain, "bin");
    onOutput("Compiling the CUDA kernel (several minutes)…");
    await runCommand(
      "uv",
      // --no-cache: uv's cache already holds the CPU-only wheel from the
      // normal install and would happily reuse it.
      ["pip", "install", "--python", python, "--target", staged, "--no-deps", "--no-build-isolation", "--no-cache", FAST_TRANSFORMERS],
      {
        onOutput,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          CUDA_HOME: toolchain,
          CPATH: path.join(toolchain, "include"),
          CC: path.join(bin, "x86_64-conda-linux-gnu-gcc"),
          CXX: path.join(bin, "x86_64-conda-linux-gnu-g++"),
          TORCH_CUDA_ARCH_LIST: CUDA_ARCH_LIST,
          // nvcc jobs are memory-hungry with six target architectures each.
          MAX_JOBS: String(Math.min(8, os.cpus().length)),
        },
      },
    );

    onOutput("Checking the new kernel on your GPU…");
    await runCommand(python, ["-c", VERIFY_SCRIPT], {
      env: { ...process.env, PYTHONPATH: staged, KWESI_STAGED: staged },
      onOutput,
    });

    installStaged(staged);
    onOutput("Done — MuseCoco now trains and generates on the GPU.");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    try {
      fs.rmdirSync(path.dirname(work)); // the shared .build dir, only if now empty
    } catch {
      // not empty or already gone
    }
  }
}
