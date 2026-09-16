import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { GlassPanel } from "../components/ui/GlassPanel";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { WorkspacesIcon, ChevronDownIcon } from "../components/ui/icons";
import {
  kwesiDb,
  type WorkspaceRow,
  type ProjectRow,
  type GenerationRow,
  type ModelVariantRow,
} from "../lib/db";
import { kwesiGeneration, type GenerationProgressEvent } from "../lib/generation";
import { kwesiArtistProfiles, type ArtistProfile } from "../lib/artistProfiles";
import { getManifest, outputKindOf } from "../data/manifests";
import { DynamicGenerationForm } from "../components/generation/DynamicGenerationForm";
import { LibraryCard, type LibraryItem } from "../components/library/LibraryCard";

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
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

/**
 * The hero's top-left control: a pill naming the current project that opens
 * a menu to jump between the workspace's other projects or delete one. Just
 * the project — the workspace name and "New Project" now live in the
 * screen's own PageHeader above the card, so they don't need repeating here.
 */
function ProjectSwitcher({
  projects,
  selectedId,
  onSelect,
  onRequestDelete,
}: {
  projects: ProjectRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestDelete: (project: ProjectRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        className="kwesi-glass inline-flex h-9 items-center gap-1.5 rounded-chip pl-3 pr-2 text-xs font-medium text-ink transition-colors duration-150 hover:brightness-105"
      >
        <span className="max-w-[11rem] truncate">{selected?.name ?? "Project"}</span>
        <ChevronDownIcon width={14} height={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        // Portaled to document.body rather than positioned relative to the
        // trigger in place: the trigger lives inside the hero's own
        // kwesi-glass box, which applies its own backdrop-filter — nesting
        // a second backdrop-filter surface inside that (this menu is also
        // kwesi-glass-strong) renders with no real background at all, as if
        // transparent, the same reason Modal/ConfirmDialog portal instead of
        // rendering inline. Positioned from the trigger's real coordinates
        // since it's no longer a CSS-relative child of it.
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
            className="kwesi-glass-strong z-50 flex w-60 flex-col gap-0.5 rounded-[14px] p-1.5 shadow-glass"
          >
            <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              Projects · {projects.length}
            </p>
            <ul className="kwesi-scroll-inset flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {projects.map((project) => (
                <li key={project.id} className="group relative">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onSelect(project.id);
                    }}
                    className={`w-full truncate rounded-[9px] py-1.5 pl-2.5 pr-8 text-left text-xs transition-colors duration-150 ${
                      project.id === selectedId ? "bg-ink/[0.1] text-ink" : "text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
                    }`}
                  >
                    {project.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onRequestDelete(project);
                    }}
                    aria-label={`Delete ${project.name}`}
                    className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-[6px] px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-red-500/10 hover:text-red-600 group-hover:block"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Takes over the whole card while a new track is being set up — the player
 * and the track list are both about tracks that already exist, so neither
 * has anything to say until this is submitted or cancelled.
 */
function NewTrackForm({
  modelId,
  installedVariantNames,
  extraVariantNames,
  artistProfiles,
  onCancel,
  onSubmit,
}: {
  modelId: string;
  installedVariantNames: string[];
  extraVariantNames: string[];
  artistProfiles: ArtistProfile[];
  onCancel: () => void;
  onSubmit: (checkpointVariant: string | null, values: Record<string, unknown>) => void;
}) {
  const manifest = getManifest(modelId);
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink/10 px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">New track</h2>
          {manifest?.displayName && <p className="truncate text-xs text-ink-muted">{manifest.displayName}</p>}
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 rounded-[8px] px-2 py-1 text-xs text-ink-muted transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600"
        >
          Cancel
        </button>
      </div>
      <div className="kwesi-scroll-inset mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-5">
        {manifest ? (
          <DynamicGenerationForm
            manifest={manifest}
            installedVariantNames={installedVariantNames}
            extraVariantNames={extraVariantNames}
            artistProfiles={artistProfiles}
            onSubmit={onSubmit}
          />
        ) : (
          <p className="text-sm text-ink-muted">No manifest found for this model.</p>
        )}
      </div>
    </>
  );
}

function ProjectPane({
  workspace,
  project,
  projects,
  variants,
  artistProfiles,
  onSelectProject,
  onRequestDeleteProject,
}: {
  workspace: WorkspaceRow | null;
  project: ProjectRow;
  projects: ProjectRow[];
  variants: ModelVariantRow[];
  artistProfiles: ArtistProfile[];
  onSelectProject: (id: string) => void;
  onRequestDeleteProject: (project: ProjectRow) => void;
}) {
  const modelId = workspace?.model_id ?? "";
  const [generations, setGenerations] = useState<GenerationRow[] | null>(null);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);
  // The new-track form takes over the whole card while this is true.
  const [isCreating, setIsCreating] = useState(false);

  const installedVariantNames = useMemo(
    () => variants.filter((v) => v.install_status === "installed").map((v) => v.variant_name),
    [variants],
  );
  // Trained-model variants (model_variant rows created by trainingManager.ts
  // on a completed run) aren't in the manifest's static checkpointVariants
  // list — merged in separately, since DynamicGenerationForm treats them as
  // always-usable regardless of the catalog list.
  const trainedVariantNames = useMemo(
    () =>
      variants
        .filter((v) => v.install_status === "installed" && v.source === "trained")
        .map((v) => v.variant_name),
    [variants],
  );

  async function refresh() {
    setGenerations(await kwesiDb.listGenerations(project.id));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const unsubscribe = kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "server_status") return;
      if (event.projectId !== project.id) return;
      refresh();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Keep a track selected whenever one exists, so the hero is never empty
  // next to a populated list. Selection alone never starts playback — only
  // clicking a row does.
  useEffect(() => {
    if (!generations) return;
    const stillExists = generations.some((g) => g.id === selectedGenerationId);
    if (!stillExists) setSelectedGenerationId(generations[0]?.id ?? null);
  }, [generations, selectedGenerationId]);

  async function submitGeneration(checkpointVariant: string | null, values: Record<string, unknown>) {
    const manifest = getManifest(modelId);
    if (!manifest) return;
    const result = await kwesiGeneration.submit(project.id, checkpointVariant, values, outputKindOf(manifest));
    if (result.ok) {
      setIsCreating(false);
      if (result.generation) setSelectedGenerationId(result.generation.id);
      refresh();
    }
  }

  const items: LibraryItem[] = useMemo(
    () =>
      (generations ?? []).map((generation) => ({
        generation,
        modelId,
        modelDisplayName: workspace?.model_display_name ?? modelId,
      })),
    [generations, modelId, workspace?.model_display_name],
  );

  return (
    <LibraryCard
      items={items}
      artistProfiles={artistProfiles}
      selectedId={selectedGenerationId}
      onSelect={setSelectedGenerationId}
      onDelete={async (item) => {
        await kwesiDb.deleteGeneration(item.generation.id, true);
        refresh();
      }}
      mode="project"
      headerSlot={
        <ProjectSwitcher
          projects={projects}
          selectedId={project.id}
          onSelect={onSelectProject}
          onRequestDelete={onRequestDeleteProject}
        />
      }
      onNew={() => setIsCreating(true)}
      isCreating={isCreating}
      form={
        <NewTrackForm
          modelId={modelId}
          installedVariantNames={installedVariantNames}
          extraVariantNames={trainedVariantNames}
          artistProfiles={artistProfiles}
          onCancel={() => setIsCreating(false)}
          onSubmit={submitGeneration}
        />
      }
    />
  );
}

export function WorkspaceDetailScreen() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [variants, setVariants] = useState<ModelVariantRow[]>([]);
  const [artistProfiles, setArtistProfiles] = useState<ArtistProfile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<ProjectRow | null>(null);
  const [deleteFilesToo, setDeleteFilesToo] = useState(false);

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

  useEffect(() => {
    kwesiArtistProfiles.list().then(setArtistProfiles);
  }, []);

  // Keep a project selected whenever one exists.
  useEffect(() => {
    if (!projects) return;
    const stillExists = projects.some((p) => p.id === selectedProjectId);
    if (!stillExists) setSelectedProjectId(projects[0]?.id ?? null);
  }, [projects, selectedProjectId]);

  if (!workspaceId) return null;

  const selectedProject = projects?.find((p) => p.id === selectedProjectId) ?? null;
  const installedCount = variants.filter((v) => v.install_status === "installed").length;

  return (
    <div className="flex h-full flex-col">
      {/* Always shown, regardless of selection or project count — this used
          to live only inside the hero card's own top-left slot, which meant
          the workspace's name and the way back to Workspaces both vanished
          the moment a project was selected (the hero swaps that slot for
          the project switcher instead). A real page title shouldn't come
          and go with what's selected below it. */}
      <PageHeader
        title={workspace?.name ?? "…"}
        backTo="/workspaces"
        backLabel="Workspaces"
        subtitle={
          <>
            <span>{workspace?.model_display_name}</span>
            {installedCount > 0 && (
              <span>
                {" "}
                · {installedCount} checkpoint{installedCount === 1 ? "" : "s"} installed
              </span>
            )}
          </>
        }
        actions={<PillButton onClick={() => setShowNewProject(true)}>New Project</PillButton>}
      />

      {projects === null ? null : projects.length === 0 ? (
        <GlassPanel radius="panel" className="flex min-h-0 flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<WorkspacesIcon width={28} height={28} />}
            title={`No projects yet in ${workspace?.name ?? "this workspace"}.`}
            action={<PillButton onClick={() => setShowNewProject(true)}>Create your first project</PillButton>}
          />
        </GlassPanel>
      ) : (
        selectedProject && (
          <ProjectPane
            key={selectedProject.id}
            workspace={workspace}
            project={selectedProject}
            projects={projects}
            variants={variants}
            artistProfiles={artistProfiles}
            onSelectProject={setSelectedProjectId}
            onRequestDeleteProject={(project) => {
              setDeleteFilesToo(false);
              setProjectPendingDelete(project);
            }}
          />
        )
      )}

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={async (name) => {
            const created = await kwesiDb.createProject(workspaceId, name);
            setShowNewProject(false);
            await refresh();
            setSelectedProjectId(created.id);
          }}
        />
      )}

      {projectPendingDelete && (
        <ConfirmDialog
          title={`Delete "${projectPendingDelete.name}"?`}
          description={
            <div className="flex flex-col gap-2.5">
              <p>This removes the project and every track inside it.</p>
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
          onCancel={() => setProjectPendingDelete(null)}
          onConfirm={async () => {
            await kwesiDb.deleteProject(projectPendingDelete.id, deleteFilesToo);
            setProjectPendingDelete(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
