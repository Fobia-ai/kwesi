// Kwesi database schema. See kwesi.docs/02-architecture.md "Data model".
// Embedded as a string (rather than a loose .sql asset) so it survives
// asar packaging with no separate copy-to-dist build step.
export const SCHEMA_SQL = `
-- A workspace binds permanently to a model FAMILY (this table); the
-- specific checkpoint variant/size is chosen per generation job, so
-- install-state fields live per-variant in model_variant below, not here.
CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  license_tier TEXT NOT NULL,
  trainable INTEGER NOT NULL DEFAULT 0,
  venv_path TEXT
);

-- install_status: not_installed | queued | downloading | installed | failed.
-- The bytes_*/current_file/error columns track an in-flight (or last-
-- failed) download's progress -- see electron/models/downloadQueue.ts. A
-- variant found "queued"/"downloading" with no active job at app startup
-- (e.g. after a crash) is swept to "failed" in database.ts rather than left
-- lying silently -- see kwesi.docs/02-architecture.md.
CREATE TABLE IF NOT EXISTS model_variant (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES model(id),
  variant_name TEXT NOT NULL,
  install_status TEXT NOT NULL DEFAULT 'not_installed',
  install_path TEXT,
  disk_size_bytes INTEGER,
  repo_id TEXT,
  source TEXT NOT NULL DEFAULT 'huggingface',
  manual_note TEXT,
  manual_url TEXT,
  bytes_downloaded INTEGER,
  bytes_total INTEGER,
  current_file TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES model(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generation (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  input_params TEXT NOT NULL DEFAULT '{}',
  output_kind TEXT,
  output_files TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  checkpoint_variant TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT,
  email TEXT,
  avatar_path TEXT
);

CREATE TABLE IF NOT EXISTS training_run (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES model(id),
  base_checkpoint_variant TEXT,
  run_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  dataset_manifest TEXT NOT NULL DEFAULT '{}',
  hyperparams TEXT NOT NULL DEFAULT '{}',
  output_dir TEXT,
  output_checkpoint_id TEXT,
  log_path TEXT,
  pid INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS trained_model (
  id TEXT PRIMARY KEY,
  base_model_id TEXT NOT NULL REFERENCES model(id),
  training_run_id TEXT NOT NULL REFERENCES training_run(id),
  display_name TEXT NOT NULL,
  checkpoint_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_workspace ON project(workspace_id);
CREATE INDEX IF NOT EXISTS idx_generation_project ON generation(project_id);
CREATE INDEX IF NOT EXISTS idx_model_variant_model ON model_variant(model_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_variant_unique ON model_variant(model_id, variant_name);
`;
