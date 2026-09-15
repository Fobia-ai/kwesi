import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { WorkspacesIcon } from "../components/ui/icons";

export function WorkspacesScreen() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-sm text-ink-muted">
            Each workspace is bound to one model, chosen when it's created.
          </p>
        </div>
        <PillButton disabled title="Wired up in Phase 2 — see kwesi.docs/04-roadmap.md">
          New Workspace
        </PillButton>
      </div>
      <EmptyState
        icon={<WorkspacesIcon width={28} height={28} />}
        title="No workspaces yet. Workspace creation lands in Phase 2."
      />
    </div>
  );
}
