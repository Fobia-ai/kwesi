import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { GlassPanel } from "../components/ui/GlassPanel";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { WorkspacesIcon } from "../components/ui/icons";
import {
  kwesiDb,
  type WorkspaceRow,
  type ProjectRow,
  type GenerationRow,
  type ModelVariantRow,
} from "../lib/db";

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal title="New Project" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="e.g. Verse ideas"
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
            Create
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}

function ProjectCard({
  project,
  variants,
  onDeleted,
}: {
  project: ProjectRow;
  variants: ModelVariantRow[];
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [generations, setGenerations] = useState<GenerationRow[]>([]);
  const [variant, setVariant] = useState(variants[0]?.variant_name ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteFilesToo, setDeleteFilesToo] = useState(false);

  async function refresh() {
    setGenerations(await kwesiDb.listGenerations(project.id));
  }

  useEffect(() => {
    if (expanded) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function addPlaceholder() {
    await kwesiDb.createPlaceholderGeneration(project.id, variant || undefined);
    refresh();
  }

  async function removeGeneration(id: string) {
    await kwesiDb.deleteGeneration(id, true);
    refresh();
  }

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between">
        <button
          className="text-left text-sm font-medium"
          onClick={() => setExpanded((v) => !v)}
        >
          {project.name}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-[8px] px-2 py-1 text-xs text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
          >
            {expanded ? "Hide" : "Open"}
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="rounded-[8px] px-2 py-1 text-xs text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-ink/10 pt-4">
          {variants.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <label className="text-xs text-ink-muted">Checkpoint variant</label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="kwesi-glass rounded-[8px] px-2 py-1 text-xs outline-none"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.variant_name}>
                    {v.variant_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <PillButton
            variant="ghost"
            className="!px-4 !py-1.5 text-xs"
            onClick={addPlaceholder}
          >
            + Add generation
          </PillButton>

          {generations.length === 0 ? (
            <p className="mt-3 text-xs text-ink-muted">No generations yet in this project.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {generations.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-[8px] bg-ink/[0.03] px-3 py-2 text-xs"
                >
                  <span>
                    {g.status}
                    {g.checkpoint_variant ? ` — ${g.checkpoint_variant}` : ""}
                  </span>
                  <button
                    onClick={() => removeGeneration(g.id)}
                    className="text-ink-muted hover:text-ink"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${project.name}"?`}
          description={
            <div className="flex flex-col gap-2.5">
              <p>This removes the project and every generation inside it.</p>
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
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await kwesiDb.deleteProject(project.id, deleteFilesToo);
            setConfirmingDelete(false);
            onDeleted();
          }}
        />
      )}
    </GlassPanel>
  );
}

export function WorkspaceDetailScreen() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [variants, setVariants] = useState<ModelVariantRow[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);

  async function refresh() {
    if (!workspaceId) return;
    const all = await kwesiDb.listWorkspaces();
    const found = all.find((w) => w.id === workspaceId) ?? null;
    setWorkspace(found);
    setProjects(await kwesiDb.listProjects(workspaceId));
    if (found) setVariants(await kwesiDb.listModelVariants(found.model_id));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (!workspaceId) return null;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <button
        onClick={() => navigate("/workspaces")}
        className="mb-4 self-start text-xs text-ink-muted hover:text-ink"
      >
        ← Workspaces
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{workspace?.name ?? "…"}</h1>
          <p className="text-sm text-ink-muted">{workspace?.model_display_name}</p>
        </div>
        <PillButton onClick={() => setShowNewProject(true)}>New Project</PillButton>
      </div>

      {projects === null ? null : projects.length === 0 ? (
        <EmptyState
          icon={<WorkspacesIcon width={28} height={28} />}
          title="No projects yet in this workspace."
          action={<PillButton onClick={() => setShowNewProject(true)}>Create your first project</PillButton>}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} variants={variants} onDeleted={refresh} />
          ))}
        </div>
      )}

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={async (name) => {
            await kwesiDb.createProject(workspaceId, name);
            setShowNewProject(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
