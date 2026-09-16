import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.js";
import { SEED_MODELS, type SeedModel } from "./seedModels.js";

let db: Database.Database | null = null;

// Handles a `model_variant` table created before Phase 3's repo_id/source/
// download-progress columns existed. Fresh databases get every column from
// SCHEMA_SQL directly; this only matters for a dev DB from an earlier phase.
function migrateModelVariantColumns(database: Database.Database) {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(model_variant)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  const wanted: Array<[string, string]> = [
    ["repo_id", "TEXT"],
    ["source", "TEXT NOT NULL DEFAULT 'huggingface'"],
    ["manual_note", "TEXT"],
    ["manual_url", "TEXT"],
    ["gateway_filename", "TEXT"],
    ["bytes_downloaded", "INTEGER"],
    ["bytes_total", "INTEGER"],
    ["current_file", "TEXT"],
    ["error", "TEXT"],
  ];
  for (const [name, ddl] of wanted) {
    if (!existing.has(name)) {
      database.exec(`ALTER TABLE model_variant ADD COLUMN ${name} ${ddl}`);
    }
  }
}

// One-time, narrowly-targeted cleanup for MusicGen's discontinued "style"
// variant (see the comment on MUSICGEN in src/data/manifests.ts for why it
// was removed) -- deliberately NOT a general "prune anything missing from
// SEED_MODELS" sweep, since trained-model variants (source: "trained",
// inserted by trainingManager.ts) legitimately exist outside SEED_MODELS
// too and must never be touched by a cleanup like this. Deletes the real
// downloaded checkpoint from disk (if it was ever installed) and the DB
// row itself, not just resetting install_status the way removeVariant()
// (electron/models/downloadQueue.ts, the normal user-facing Remove button)
// does -- this variant is gone from the catalog, not just uninstalled.
function removeDiscontinuedMusicGenStyleVariant(database: Database.Database) {
  const row = database
    .prepare("SELECT id, install_path FROM model_variant WHERE model_id = 'musicgen' AND variant_name = 'style'")
    .get() as { id: string; install_path: string | null } | undefined;
  if (!row) return;
  if (row.install_path) fs.rmSync(row.install_path, { recursive: true, force: true });
  database.prepare("DELETE FROM model_variant WHERE id = ?").run(row.id);
}

// Runs on every startup (not just first-run) so the catalog in
// seedModels.ts stays the source of truth as it evolves -- new models/
// variants get inserted, existing catalog metadata (display name, repo_id,
// manual note/url) gets refreshed, but per-row install state
// (install_status/install_path/disk_size_bytes/...) is left untouched since
// it isn't part of the INSERT...ON CONFLICT column list.
function syncSeedModels(database: Database.Database, models: SeedModel[]) {
  const upsertModel = database.prepare(`
    INSERT INTO model (id, display_name, license_tier, trainable)
    VALUES (@id, @displayName, @licenseTier, @trainable)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      license_tier = excluded.license_tier,
      trainable = excluded.trainable
  `);
  const upsertVariant = database.prepare(`
    INSERT INTO model_variant (id, model_id, variant_name, source, repo_id, manual_note, manual_url, gateway_filename)
    VALUES (@id, @modelId, @variantName, @source, @repoId, @manualNote, @manualUrl, @gatewayFilename)
    ON CONFLICT(model_id, variant_name) DO UPDATE SET
      source = excluded.source,
      repo_id = excluded.repo_id,
      manual_note = excluded.manual_note,
      manual_url = excluded.manual_url,
      gateway_filename = excluded.gateway_filename
  `);

  const run = database.transaction((seedModels: SeedModel[]) => {
    for (const m of seedModels) {
      upsertModel.run({
        id: m.id,
        displayName: m.displayName,
        licenseTier: m.licenseTier,
        trainable: m.trainable ? 1 : 0,
      });
      for (const v of m.variants) {
        upsertVariant.run({
          id: randomUUID(),
          modelId: m.id,
          variantName: v.name,
          source: v.source,
          repoId: v.repoId ?? null,
          manualNote: v.note ?? null,
          manualUrl: v.url ?? null,
          gatewayFilename: v.gatewayFilename ?? null,
        });
      }
    }
  });
  run(models);
}

// Handles an `artist_profile` table created before the genres column
// existed -- same precedent as migrateModelVariantColumns above.
function migrateArtistProfileColumns(database: Database.Database) {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(artist_profile)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!existing.has("genres")) {
    database.exec(`ALTER TABLE artist_profile ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!existing.has("languages")) {
    database.exec(`ALTER TABLE artist_profile ADD COLUMN languages TEXT NOT NULL DEFAULT '[]'`);
  }
}

// A variant left "queued"/"downloading" here means the app quit or crashed
// mid-download with no queue worker left running to finish it -- surface
// that plainly as failed (with a clear error) rather than leaving it stuck
// showing a progress bar that will never move again.
function resetInterruptedDownloads(database: Database.Database) {
  database
    .prepare(
      `UPDATE model_variant
       SET install_status = 'failed',
           error = 'Interrupted -- the app quit before this download finished',
           bytes_downloaded = NULL,
           bytes_total = NULL,
           current_file = NULL
       WHERE install_status IN ('queued', 'downloading')`,
    )
    .run();
}

export function openDatabase(dbPath: string): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  migrateModelVariantColumns(db);
  migrateArtistProfileColumns(db);
  removeDiscontinuedMusicGenStyleVariant(db);
  syncSeedModels(db, SEED_MODELS);
  resetInterruptedDownloads(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error("Database not initialized — call openDatabase() first");
  return db;
}
