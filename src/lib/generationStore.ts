import type { GenerationRow } from "./db";

/**
 * localStorage-backed mock of the `generation` table, used only when
 * running as a plain web page during UI development (no Electron main
 * process / SQLite available). Split out from src/lib/db.ts's mock state
 * the same way src/lib/modelVariantStore.ts is split out — shared by
 * src/lib/db.ts (listing/CRUD) and src/lib/generation.ts (the mock job
 * queue, which mutates rows as a generation progresses).
 */
const KEY = "kwesi-mock-generations-v1";

function load(): GenerationRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as GenerationRow[];
  } catch {
    // ignore — fall through to empty state
  }
  return [];
}

function save(rows: GenerationRow[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // best-effort only; mock persistence is a dev convenience, not a guarantee
  }
}

export function listAll(): GenerationRow[] {
  return load();
}

export function listForProject(projectId: string): GenerationRow[] {
  return load().filter((r) => r.project_id === projectId);
}

export function getById(id: string): GenerationRow | undefined {
  return load().find((r) => r.id === id);
}

export function insert(row: GenerationRow): void {
  const rows = load();
  rows.push(row);
  save(rows);
}

export function update(id: string, patch: Partial<GenerationRow>): void {
  const rows = load();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return;
  rows[idx] = { ...rows[idx], ...patch };
  save(rows);
}

export function remove(id: string): void {
  save(load().filter((r) => r.id !== id));
}

export function removeForProjects(projectIds: string[]): void {
  save(load().filter((r) => !projectIds.includes(r.project_id)));
}
