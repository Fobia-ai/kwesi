import { MODEL_VARIANTS_SEED, type SeedVariant } from "../data/modelVariants";
import type { ModelVariantRow } from "./db";

/**
 * localStorage-backed mock of the model_variant table, used only when
 * running as a plain web page during UI development (no Electron main
 * process / SQLite available) — mirrors electron/db/repositories.ts's
 * model_variant rows closely enough to exercise the Model Manager UI.
 * Shared by src/lib/db.ts (read-only listing) and src/lib/models.ts
 * (install/remove/progress mutations) so both see the same state.
 */
const KEY = "kwesi-mock-model-variants-v1";

function seedRow(modelId: string, v: SeedVariant): ModelVariantRow {
  return {
    id: `${modelId}:${v.name}`,
    model_id: modelId,
    variant_name: v.name,
    install_status: "not_installed",
    install_path: null,
    disk_size_bytes: null,
    repo_id: v.repoId ?? null,
    source: v.source,
    manual_note: v.note ?? null,
    manual_url: v.url ?? null,
    bytes_downloaded: null,
    bytes_total: null,
    current_file: null,
    error: null,
  };
}

function seedAll(): ModelVariantRow[] {
  return MODEL_VARIANTS_SEED.flatMap((m) => m.variants.map((v) => seedRow(m.id, v)));
}

function load(): ModelVariantRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ModelVariantRow[];
  } catch {
    // ignore — fall through to a fresh seed
  }
  return seedAll();
}

function save(rows: ModelVariantRow[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // best-effort only; mock persistence is a dev convenience, not a guarantee
  }
}

export function listAll(): ModelVariantRow[] {
  return load();
}

export function listForModel(modelId: string): ModelVariantRow[] {
  return load().filter((r) => r.model_id === modelId);
}

export function getById(id: string): ModelVariantRow | undefined {
  return load().find((r) => r.id === id);
}

export function update(id: string, patch: Partial<ModelVariantRow>): void {
  const rows = load();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return;
  rows[idx] = { ...rows[idx], ...patch };
  save(rows);
}
