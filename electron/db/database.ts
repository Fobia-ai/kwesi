import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.js";
import { SEED_MODELS } from "./seedModels.js";

let db: Database.Database | null = null;

export function openDatabase(dbPath: string): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const modelCount = (db.prepare("SELECT COUNT(*) AS n FROM model").get() as { n: number }).n;
  if (modelCount === 0) {
    const insertModel = db.prepare(
      "INSERT INTO model (id, display_name, license_tier, trainable) VALUES (@id, @displayName, @licenseTier, @trainable)",
    );
    const insertVariant = db.prepare(
      "INSERT INTO model_variant (id, model_id, variant_name) VALUES (?, ?, ?)",
    );
    const insertMany = db.transaction((models: typeof SEED_MODELS) => {
      for (const m of models) {
        insertModel.run({ ...m, trainable: m.trainable ? 1 : 0 });
        for (const variantName of m.variants) {
          insertVariant.run(randomUUID(), m.id, variantName);
        }
      }
    });
    insertMany(SEED_MODELS);
  }

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error("Database not initialized — call openDatabase() first");
  return db;
}
