import { CATALOG, LICENSE_LABEL } from "../data/catalog";

export function ModelManagerScreen() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Model Manager</h1>
        <p className="text-sm text-ink-muted">
          Browse the catalog. Download/install lands in Phase 3 — see kwesi.docs/04-roadmap.md.
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        {CATALOG.map((entry) => (
          <div
            key={entry.modelId}
            className="kwesi-glass flex items-center justify-between gap-3 rounded-card px-4 py-3.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{entry.displayName}</span>
                <span className="rounded-chip bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  {LICENSE_LABEL[entry.licenseTier]}
                </span>
                {entry.trainable && (
                  <span className="rounded-chip bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                    Trainable
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-ink-muted">{entry.description}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-muted">Not installed</span>
          </div>
        ))}
      </div>
    </div>
  );
}
