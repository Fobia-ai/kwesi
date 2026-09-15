import { useEffect, useMemo, useState } from "react";
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
import { kwesiGeneration, type GenerationProgressEvent } from "../lib/generation";
import { getManifest, outputKindOf } from "../data/manifests";
import { LICENSE_LABEL } from "../data/catalog";
import { DynamicGenerationForm } from "../components/generation/DynamicGenerationForm";
import { OutputViewerPlaceholder, type GenerationStatus } from "../components/generation/OutputViewerPlaceholder";
import { WaveformPlayer } from "../components/audio/WaveformPlayer";
import { PianoRollViewer } from "../components/midi/PianoRollViewer";
import { findAudioFile, findMidiFile, parseOutputFiles } from "../lib/audioFiles";

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

function NewGenerationModal({
  modelId,
  installedVariantNames,
  onClose,
  onSubmit,
}: {
  modelId: string;
  installedVariantNames: string[];
  onClose: () => void;
  onSubmit: (checkpointVariant: string | null, values: Record<string, unknown>) => void;
}) {
  const manifest = getManifest(modelId);
  return (
    <Modal title="New Generation" onClose={onClose}>
      {manifest ? (
        <DynamicGenerationForm
          manifest={manifest}
          installedVariantNames={installedVariantNames}
          onSubmit={onSubmit}
        />
      ) : (
        <p className="text-sm text-ink-muted">No manifest found for this model.</p>
      )}
    </Modal>
  );
}

// Phase 8: non-commercial-licensed outputs (YuE2, MusicGen) get a visible
// badge wherever they can be exported/shared, per the roadmap's licensing
// requirement — surfaced here rather than inside WaveformPlayer/
// PianoRollViewer themselves, since those are reused as-is from Phase 6/7
// and this is a per-generation (model-level), not per-player, concern. MIT
// models render no badge — nothing to warn about.
function LicenseBadge({ modelId }: { modelId: string }) {
  const manifest = getManifest(modelId);
  if (!manifest || manifest.licenseTier === "mit") return null;
  return (
    <span
      className="shrink-0 rounded-chip bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
      title={`${manifest.displayName} output is licensed ${LICENSE_LABEL[manifest.licenseTier]} — non-commercial use only.`}
    >
      {LICENSE_LABEL[manifest.licenseTier]}
    </span>
  );
}

function GenerationListItem({
  generation,
  projectName,
  modelId,
  onDeleted,
}: {
  generation: GenerationRow;
  projectName: string;
  modelId: string;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  useEffect(() => {
    const unsubscribe = kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "server_status") return;
      if (event.generationId !== generation.id) return;
      if (event.type === "running") setProgressPct(event.progressPct);
    });
    return unsubscribe;
  }, [generation.id]);

  const done = generation.status === "done";
  const outputKind = generation.output_kind as "audio" | "midi" | "audio+midi" | null;
  const outputFiles = useMemo(() => parseOutputFiles(generation.output_files), [generation.output_files]);
  const audioFile = useMemo(() => findAudioFile(outputFiles), [outputFiles]);
  const midiFile = useMemo(() => findMidiFile(outputFiles), [outputFiles]);
  const showAudioPlayer = done && (outputKind === "audio" || outputKind === "audio+midi") && Boolean(audioFile);
  const showPianoRoll = done && (outputKind === "midi" || outputKind === "audio+midi") && Boolean(midiFile);
  const showMidiSlot = done && (outputKind === "midi" || outputKind === "audio+midi") && !midiFile;
  const title = `${projectName} — ${generation.checkpoint_variant ?? "generation"}`;

  return (
    <li className="rounded-[8px] bg-ink/[0.03] px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-2 text-left" onClick={() => setExpanded((v) => !v)}>
          {generation.status}
          {generation.checkpoint_variant ? ` — ${generation.checkpoint_variant}` : ""}
          {done && <LicenseBadge modelId={modelId} />}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded((v) => !v)} className="text-ink-muted hover:text-ink">
            {expanded ? "Less" : "More"}
          </button>
          <button
            onClick={() => onDeleted()}
            className="text-ink-muted hover:text-ink"
          >
            Delete
          </button>
        </div>
      </div>

      {!done && expanded && (
        <div className="mt-2">
          <OutputViewerPlaceholder
            outputKind={outputKind ?? "audio"}
            status={generation.status as GenerationStatus}
            progressPct={progressPct}
            error={generation.error}
          />
        </div>
      )}

      {showAudioPlayer && (
        <div className="mt-2">
          <WaveformPlayer
            generationId={generation.id}
            filePath={audioFile as string}
            title={title}
            compact={!expanded}
          />
        </div>
      )}

      {showPianoRoll && (
        <div className="mt-2">
          <PianoRollViewer filePath={midiFile as string} title={title} compact={!expanded} />
        </div>
      )}

      {showMidiSlot && expanded && (
        <div className="mt-2">
          <OutputViewerPlaceholder outputKind="midi" status="done" />
        </div>
      )}

      {done && !showAudioPlayer && !showPianoRoll && !showMidiSlot && expanded && (
        <p className="mt-2 text-ink-muted">No output files for this generation.</p>
      )}
    </li>
  );
}

function ProjectCard({
  project,
  modelId,
  variants,
  onDeleted,
}: {
  project: ProjectRow;
  modelId: string;
  variants: ModelVariantRow[];
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [generations, setGenerations] = useState<GenerationRow[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteFilesToo, setDeleteFilesToo] = useState(false);
  const [showGenerationModal, setShowGenerationModal] = useState(false);

  const installedVariantNames = useMemo(
    () => variants.filter((v) => v.install_status === "installed").map((v) => v.variant_name),
    [variants],
  );

  async function refresh() {
    setGenerations(await kwesiDb.listGenerations(project.id));
  }

  useEffect(() => {
    if (expanded) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const unsubscribe = kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "server_status") return;
      if (event.projectId !== project.id) return;
      refresh();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, project.id]);

  async function submitGeneration(checkpointVariant: string | null, values: Record<string, unknown>) {
    const manifest = getManifest(modelId);
    if (!manifest) return;
    const result = await kwesiGeneration.submit(project.id, checkpointVariant, values, outputKindOf(manifest));
    if (result.ok) {
      setShowGenerationModal(false);
      refresh();
    }
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
          <PillButton
            variant="ghost"
            className="!px-4 !py-1.5 text-xs"
            onClick={() => setShowGenerationModal(true)}
          >
            + New Generation
          </PillButton>

          {generations.length === 0 ? (
            <p className="mt-3 text-xs text-ink-muted">No generations yet in this project.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {generations.map((g) => (
                <GenerationListItem
                  key={g.id}
                  generation={g}
                  projectName={project.name}
                  modelId={modelId}
                  onDeleted={() => removeGeneration(g.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {showGenerationModal && (
        <NewGenerationModal
          modelId={modelId}
          installedVariantNames={installedVariantNames}
          onClose={() => setShowGenerationModal(false)}
          onSubmit={submitGeneration}
        />
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
            <ProjectCard
              key={p.id}
              project={p}
              modelId={workspace?.model_id ?? ""}
              variants={variants}
              onDeleted={refresh}
            />
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
