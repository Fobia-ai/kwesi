import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { PillButton } from "../components/ui/PillButton";
import { WaveformIcon, HeadphonesIcon } from "../components/ui/icons";
import { LibraryCard, type LibraryItem } from "../components/library/LibraryCard";
import { ModelsDriftBanner } from "../components/home/ModelsDriftBanner";
import { kwesiDb, type LibraryGenerationRow, type WorkspaceRow } from "../lib/db";
import { kwesiGeneration, type GenerationProgressEvent } from "../lib/generation";
import { kwesiArtistProfiles, type ArtistProfile } from "../lib/artistProfiles";

/**
 * The default tab: one player over every track in the app, regardless of
 * which workspace or project it was made in. Nothing generated yet means
 * there's nothing to play, so it hands off to creating a workspace instead.
 */
export function HomeScreen() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LibraryGenerationRow[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [artistProfiles, setArtistProfiles] = useState<ArtistProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function refresh() {
    const [generations, allWorkspaces] = await Promise.all([kwesiDb.listAllGenerations(), kwesiDb.listWorkspaces()]);
    setRows(generations);
    setWorkspaces(allWorkspaces);
  }

  useEffect(() => {
    refresh();
    kwesiArtistProfiles.list().then(setArtistProfiles);
  }, []);

  useEffect(
    () =>
      kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
        if (event.type !== "server_status") refresh();
      }),
    [],
  );

  useEffect(() => {
    if (!rows) return;
    if (!rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const items: LibraryItem[] = useMemo(
    () =>
      (rows ?? []).map((row) => ({
        generation: row,
        modelId: row.model_id,
        modelDisplayName: row.model_display_name,
        context: `${row.workspace_name} › ${row.project_name}`,
      })),
    [rows],
  );

  if (rows === null) return null;

  return (
    <div className="flex h-full flex-col">
      <ModelsDriftBanner />
      <LibraryCard
        items={items}
        artistProfiles={artistProfiles}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDelete={async (item) => {
          await kwesiDb.deleteGeneration(item.generation.id, true);
          refresh();
        }}
        mode="library"
        headerSlot={
          <span className="kwesi-glass inline-flex h-9 items-center gap-1.5 rounded-chip px-3 text-xs text-ink">
            <HeadphonesIcon width={14} height={14} />
            Library · {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
          </span>
        }
        emptyState={
          <EmptyState
            icon={<WaveformIcon width={28} height={28} />}
            title={
              workspaces.length === 0
                ? "Nothing here yet — every track starts in a workspace."
                : "No tracks yet — open a workspace to generate your first one."
            }
            action={
              workspaces.length === 0 ? (
                <PillButton onClick={() => navigate("/workspaces", { state: { openNew: true } })}>
                  Create a workspace
                </PillButton>
              ) : (
                <PillButton onClick={() => navigate("/workspaces")}>Open workspaces</PillButton>
              )
            }
          />
        }
      />
    </div>
  );
}
