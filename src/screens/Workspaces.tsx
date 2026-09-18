import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { GlassPanel } from "../components/ui/GlassPanel";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ModelSetupDialog } from "../components/models/ModelSetupDialog";
import { WorkspacesIcon } from "../components/ui/icons";
import { kwesiDb, type ModelRow, type WorkspaceRow } from "../lib/db";
import { checkModelReadiness } from "../lib/modelReadiness";

function NewWorkspaceModal({
  models,
  onClose,
  onCreated,
}: {
  models: ModelRow[];
  onClose: () => void;
  onCreated: (w: WorkspaceRow) => void;
}) {
  const [name, setName] = useState("");
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState(false);

  async function submit() {
    if (!name.trim() || !modelId) return;
    setBusy(true);
    try {
      const readiness = await checkModelReadiness(modelId);
      if (!readiness.ready) {
        setShowSetupDialog(true);
        return;
      }
      const workspace = await kwesiDb.createWorkspace(name.trim(), modelId);
      onCreated(workspace);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="New Workspace" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="e.g. Lo-fi sketches"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Model <span className="text-ink-muted">(permanent for this workspace)</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <PillButton variant="ghost" onClick={onClose}>
              Cancel
            </PillButton>
            <PillButton onClick={submit} disabled={busy || !name.trim()}>
              Create
            </PillButton>
          </div>
        </div>
      </Modal>
      {showSetupDialog && <ModelSetupDialog modelId={modelId} onClose={() => setShowSetupDialog(false)} />}
    </>
  );
}

export function WorkspacesScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  // Home's "Create a workspace" lands here with the modal already open.
  const [showNew, setShowNew] = useState(Boolean((location.state as { openNew?: boolean } | null)?.openNew));
  const [pendingDelete, setPendingDelete] = useState<WorkspaceRow | null>(null);
  const [deleteFilesToo, setDeleteFilesToo] = useState(false);

  async function refresh() {
    setWorkspaces(await kwesiDb.listWorkspaces());
  }

  useEffect(() => {
    kwesiDb.listModels().then(setModels);
    refresh();
  }, []);

  async function handleDelete() {
    if (!pendingDelete) return;
    await kwesiDb.deleteWorkspace(pendingDelete.id, deleteFilesToo);
    setPendingDelete(null);
    setDeleteFilesToo(false);
    refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Workspaces"
        subtitle="Each workspace is bound to one model, chosen when it's created."
        actions={<PillButton onClick={() => setShowNew(true)}>New Workspace</PillButton>}
      />

      {workspaces === null ? null : workspaces.length === 0 ? (
        <GlassPanel radius="panel" className="flex min-h-0 flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<WorkspacesIcon width={28} height={28} />}
            title="No workspaces yet."
            action={<PillButton onClick={() => setShowNew(true)}>Create your first workspace</PillButton>}
          />
        </GlassPanel>
      ) : (
        <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {workspaces.map((w) => (
              <div
                key={w.id}
                role="button"
                tabIndex={0}
                className="group flex cursor-pointer items-center justify-between border-b border-ink/10 px-5 py-4 transition-colors duration-150 last:border-b-0 hover:bg-ink/[0.05]"
                onClick={() => navigate(`/workspaces/${w.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") navigate(`/workspaces/${w.id}`);
                }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{w.name}</div>
                  <div className="truncate text-xs text-ink-muted">{w.model_display_name}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteFilesToo(false);
                    setPendingDelete(w);
                  }}
                  className="shrink-0 rounded-[8px] px-2 py-1 text-xs text-ink-muted opacity-0 transition-opacity duration-150 hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}

      {showNew && (
        <NewWorkspaceModal
          models={models}
          onClose={() => setShowNew(false)}
          onCreated={(w) => {
            setShowNew(false);
            navigate(`/workspaces/${w.id}`);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          description={
            <div className="flex flex-col gap-2.5">
              <p>This removes the workspace and every project/generation inside it from Kwesi.</p>
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={deleteFilesToo}
                  onChange={(e) => setDeleteFilesToo(e.target.checked)}
                />
                Also delete the files on disk
              </label>
            </div>
          }
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
