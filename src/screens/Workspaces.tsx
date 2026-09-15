import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { GlassPanel } from "../components/ui/GlassPanel";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { WorkspacesIcon } from "../components/ui/icons";
import { kwesiDb, type ModelRow, type WorkspaceRow } from "../lib/db";

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

  async function submit() {
    if (!name.trim() || !modelId) return;
    setBusy(true);
    try {
      const workspace = await kwesiDb.createWorkspace(name.trim(), modelId);
      onCreated(workspace);
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}

export function WorkspacesScreen() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [showNew, setShowNew] = useState(false);
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
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-sm text-ink-muted">
            Each workspace is bound to one model, chosen when it's created.
          </p>
        </div>
        <PillButton onClick={() => setShowNew(true)}>New Workspace</PillButton>
      </div>

      {workspaces === null ? null : workspaces.length === 0 ? (
        <EmptyState
          icon={<WorkspacesIcon width={28} height={28} />}
          title="No workspaces yet."
          action={<PillButton onClick={() => setShowNew(true)}>Create your first workspace</PillButton>}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {workspaces.map((w) => (
            <GlassPanel
              key={w.id}
              className="group flex cursor-pointer items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:brightness-105"
              onClick={() => navigate(`/workspaces/${w.id}`)}
            >
              <div>
                <div className="text-sm font-medium">{w.name}</div>
                <div className="text-xs text-ink-muted">{w.model_display_name}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteFilesToo(false);
                  setPendingDelete(w);
                }}
                className="rounded-[8px] px-2 py-1 text-xs text-ink-muted opacity-0 transition-opacity duration-150 hover:bg-ink/[0.06] hover:text-ink group-hover:opacity-100"
              >
                Delete
              </button>
            </GlassPanel>
          ))}
        </div>
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
