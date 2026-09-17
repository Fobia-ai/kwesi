import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { PillButton } from "../ui/PillButton";
import { AvatarImage } from "../ui/AvatarImage";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BottomSheet } from "../ui/BottomSheet";
import {
  SearchIcon,
  CloseIcon,
  MoreIcon,
  HeadphonesIcon,
  DownloadIcon,
  PianoRollIcon,
  RetryIcon,
} from "../ui/icons";
import { OutputViewerPlaceholder, type GenerationStatus } from "../generation/OutputViewerPlaceholder";
import { PianoRollViewer } from "../midi/PianoRollViewer";
import { AbcScoreViewer } from "../midi/AbcScoreViewer";
import { TrackControls } from "./TrackControls";
import { HeroArtwork } from "./HeroArtwork";
import {
  Chip,
  StatusChip,
  LicenseBadge,
  ParamsGrid,
  formatRelativeTime,
  generationTitle,
  generationPrompt,
  generationLyrics,
  generationGenres,
  generationArtistId,
} from "./generationDisplay";
import type { GenerationRow } from "../../lib/db";
import type { ArtistProfile } from "../../lib/artistProfiles";
import { kwesiGeneration, type GenerationProgressEvent } from "../../lib/generation";
import { kwesiAudio } from "../../lib/audio";
import { usePlayer, type PlayerTrack } from "../../lib/playerStore";
import { findAudioFile, findMidiFile, findAbcFile, parseOutputFiles, suggestedExportName } from "../../lib/audioFiles";
import { getManifest } from "../../data/manifests";

export interface LibraryItem {
  generation: GenerationRow;
  modelId: string;
  modelDisplayName: string;
  // Where the track lives, for the cross-project library view:
  // "Workspace › Project". Unset inside a single project, where it'd be the
  // same string on every row.
  context?: string;
}

interface LibraryCardBaseProps {
  items: LibraryItem[];
  artistProfiles: ArtistProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Always removes the record and every file it produced — there's no
  // "keep the files" option, the app's copy is the only one.
  onDelete: (item: LibraryItem) => Promise<void> | void;
  // Top-left of the hero: the project switcher, or the library's summary.
  headerSlot: ReactNode;
}

/**
 * The two places this card appears are the same shape but genuinely
 * different jobs, so the mode is explicit rather than inferred from which
 * optional props happened to be passed:
 *
 *  - "library" (Home) browses every track in the app read-only: no
 *    creation, and each row says which workspace/project it came from. A
 *    completely empty app (no workspaces, nothing to browse at all) has
 *    nothing structural to preserve, so it gets a full-panel `emptyState`.
 *  - "project" manages one project's tracks: creation, and rows drop the
 *    location (it's the same for all of them) for the prompt instead. A
 *    project with zero tracks still has a real toolbar (search, "+ New
 *    track") and hero to show — only the row list itself goes empty, so
 *    there's no `emptyState` prop here; the empty case is handled inline.
 */
export type LibraryCardProps = LibraryCardBaseProps &
  (
    | { mode: "library"; emptyState: ReactNode }
    | {
        mode: "project";
        onNew: () => void;
        isCreating: boolean;
        form: ReactNode;
        // Re-submits a cancelled/failed track with its original params —
        // only meaningful in "project" mode, which has a project to submit
        // into; "library" mode spans every workspace/project read-only.
        onRetry: (item: LibraryItem) => void;
      }
  );

type HeroTab = "overview" | "lyrics";

function playerTrackFor(item: LibraryItem, artist: ArtistProfile | null): PlayerTrack | null {
  if (item.generation.status !== "done") return null;
  const audioFile = findAudioFile(parseOutputFiles(item.generation.output_files));
  if (!audioFile) return null;
  return {
    generationId: item.generation.id,
    filePath: audioFile,
    title: generationTitle(item.generation),
    subtitle: artist?.name ?? item.modelDisplayName,
    avatarPath: artist?.avatarPath ?? null,
    avatarName: artist?.name ?? generationTitle(item.generation),
  };
}

function matchesQuery(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [generationTitle(item.generation), generationPrompt(item.generation), generationLyrics(item.generation)]
    .filter((s): s is string => Boolean(s))
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

/** The artist, as its own circle — same treatment as the sidebar's avatars. */
function ArtistBadge({ artist, fallbackName }: { artist: ArtistProfile | null; fallbackName: string }) {
  return (
    <div
      className="kwesi-glass-strong flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full shadow-glass-sm"
      title={artist ? artist.name : undefined}
    >
      <AvatarImage avatarPath={artist?.avatarPath ?? null} name={artist?.name ?? fallbackName} size={42} />
    </div>
  );
}

export function LibraryCard(props: LibraryCardProps) {
  const { items, artistProfiles, selectedId, onSelect, onDelete, headerSlot } = props;
  const project = props.mode === "project" ? props : null;
  const player = usePlayer();
  const [tab, setTab] = useState<HeroTab>("overview");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [midiSheetItem, setMidiSheetItem] = useState<LibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ id: string; text: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const artistFor = (generation: GenerationRow) =>
    artistProfiles.find((p) => p.id === generationArtistId(generation)) ?? null;

  const selected = items.find((i) => i.generation.id === selectedId) ?? null;
  const selectedArtist = selected ? artistFor(selected.generation) : null;
  const selectedTrack = selected ? playerTrackFor(selected, selectedArtist) : null;

  // Play order = list order, skipping anything with no audio to play.
  const queue = useMemo(
    () =>
      items
        .map((item) => playerTrackFor(item, artistFor(item.generation)))
        .filter((t): t is PlayerTrack => t !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, artistProfiles],
  );

  const visibleItems = useMemo(() => items.filter((item) => matchesQuery(item, query)), [items, query]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Live progress for the selected track while it's still generating.
  const [progressPct, setProgressPct] = useState(0);
  useEffect(() => {
    setProgressPct(0);
    if (!selectedId) return undefined;
    return kwesiGeneration.onProgress((event: GenerationProgressEvent) => {
      if (event.type === "running" && event.generationId === selectedId) setProgressPct(event.progressPct);
    });
  }, [selectedId]);

  function handleRowClick(item: LibraryItem) {
    onSelect(item.generation.id);
    const track = playerTrackFor(item, artistFor(item.generation));
    if (track) {
      player.setQueue(queue);
      void player.play(track);
      return;
    }
    // No audio to play (MuseCoco/Museformer's MIDI-only output) — opens the
    // notation in a bottom sheet instead, since there's nothing else a
    // click on this row could do and a real piano roll wants real width.
    const midiFile = findMidiFile(parseOutputFiles(item.generation.output_files));
    if (midiFile) {
      setMidiSheetItem(item);
    }
  }

  async function handleSave(item: LibraryItem) {
    const files = parseOutputFiles(item.generation.output_files);
    const file = findAudioFile(files) ?? findMidiFile(files);
    if (!file) return;
    const id = item.generation.id;
    setSaveStatus({ id, text: "Saving…" });
    const result = await kwesiAudio.save(file, suggestedExportName(file, generationTitle(item.generation)), "export");
    if (result.ok) setSaveStatus({ id, text: `Saved to ${result.path}` });
    else if (result.reason === "cancelled") setSaveStatus(null);
    else setSaveStatus({ id, text: result.reason ?? "Save failed" });
  }

  function clearSearch() {
    setQuery("");
    setSearchOpen(false);
  }

  // Setting up a new track takes the whole card: the hero and the track
  // list are both about tracks that already exist, and squeezing the form
  // into the hero above the list made both cramped.
  if (project?.isCreating) {
    return (
      <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {project.form}
      </GlassPanel>
    );
  }

  // Only "library" mode swaps the whole card for a centered empty state —
  // there's genuinely nothing structural to preserve when the entire app
  // has no tracks anywhere. A project with zero tracks still has a real
  // hero and toolbar to show; that empty case is handled inline below so
  // the toolbar (search, "+ New track") doesn't disappear along with the
  // list content.
  if (props.mode === "library" && items.length === 0) {
    return (
      <GlassPanel radius="panel" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-8">
        {props.emptyState}
      </GlassPanel>
    );
  }

  return (
    <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 p-3 pb-0">
        <div className="kwesi-glass relative flex h-[330px] flex-col overflow-hidden rounded-card">
          <div className="relative z-10 flex shrink-0 items-start justify-between gap-3 px-5 pt-4">
            <div className="min-w-0 flex-1">{headerSlot}</div>
            <div className="flex shrink-0 gap-6">
              {(["overview", "lyrics"] as HeroTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`relative pb-1 text-sm capitalize transition-colors duration-150 ${
                    tab === t ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {t}
                  {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
            <div className="hidden min-w-0 flex-1 lg:block" />
          </div>

          {tab === "overview" ? (
            <>
              <HeroArtwork className="absolute bottom-0 right-6 hidden h-[78%] lg:block" />
              <div className="relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4 lg:max-w-[68%]">
                {selected ? (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink-muted">
                        {props.mode === "library"
                          ? (selected.context ?? selected.modelDisplayName)
                          : selectedArtist
                            ? `by ${selectedArtist.name}`
                            : "Track"}
                      </p>
                      <h2 className="mt-0.5 truncate text-3xl font-semibold tracking-tight">
                        {generationTitle(selected.generation)}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <HeadphonesIcon width={15} height={15} />
                          {items.length} track{items.length === 1 ? "" : "s"}
                        </span>
                        {props.mode === "library" && selectedArtist && <span>· {selectedArtist.name}</span>}
                        <span>· {selected.modelDisplayName}</span>
                        <span>· {formatRelativeTime(selected.generation.created_at)}</span>
                        {selected.generation.status === "done" && selected.generation.duration_ms !== null && (
                          <span title="Time this generation took to run">
                            · {(selected.generation.duration_ms / 1000).toFixed(1)}s to generate
                          </span>
                        )}
                        {selected.generation.status === "done" && <LicenseBadge modelId={selected.modelId} />}
                      </div>
                      {generationGenres(selected.generation).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {generationGenres(selected.generation)
                            .slice(0, 4)
                            .map((genre) => (
                              <Chip key={genre}>{genre}</Chip>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Pushed to the hero's floor rather than left to sit
                        wherever the text above happens to end, so the
                        transport lands in the same place on every track. */}
                    <div className="mt-auto flex items-center gap-3 pt-4">
                      <ArtistBadge artist={selectedArtist} fallbackName={generationTitle(selected.generation)} />
                      <HeroPlayback
                        item={selected}
                        track={selectedTrack}
                        queue={queue}
                        progressPct={progressPct}
                        onShowLyrics={() => setTab("lyrics")}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">
                    {items.length === 0 ? "No tracks yet — use “+ New track” below to make one." : "Pick a track below to play it."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <LyricsView lyrics={selected ? generationLyrics(selected.generation) : undefined} />
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-2 pt-5">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight">
              {props.mode === "library" ? "All tracks" : "Tracks"}
            </h3>
            <p className="text-[11px] text-ink-muted">
              {query.trim()
                ? `${visibleItems.length} of ${items.length} track${items.length === 1 ? "" : "s"}`
                : `${items.length} track${items.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {items.length > 0 && (
              <div
                className={`kwesi-glass flex h-9 items-center rounded-chip transition-all duration-300 ease-smooth ${
                  searchOpen ? "w-64 px-1" : "w-9"
                }`}
              >
                <button
                  type="button"
                  onClick={() => (searchOpen ? clearSearch() : setSearchOpen(true))}
                  aria-label={searchOpen ? "Close search" : "Search tracks"}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:text-ink"
                >
                  {searchOpen ? <CloseIcon width={15} height={15} /> : <SearchIcon width={16} height={16} />}
                </button>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") clearSearch();
                  }}
                  placeholder="Track name, lyrics, or prompt"
                  aria-label="Search tracks"
                  className={`min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-muted/70 ${
                    searchOpen ? "px-1 opacity-100" : "w-0 px-0 opacity-0"
                  }`}
                  tabIndex={searchOpen ? 0 : -1}
                />
                {searchOpen && query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="mr-1 rounded-full px-1.5 text-[10px] uppercase tracking-wide text-ink-muted hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {project && (
              <PillButton className="!px-3.5 !py-1.5 text-xs" onClick={project.onNew}>
                + New track
              </PillButton>
            )}
          </div>
        </div>

        <ul className="kwesi-scroll-inset flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
          {items.length === 0 ? (
            <li className="flex flex-1 flex-col items-center justify-center gap-3 px-3 py-10 text-center">
              <p className="text-xs text-ink-muted">Nothing generated in this project yet.</p>
              {project && (
                <PillButton className="!px-3.5 !py-1.5 text-xs" onClick={project.onNew}>
                  Create your first track
                </PillButton>
              )}
            </li>
          ) : (
            visibleItems.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-ink-muted">No tracks match “{query}”.</li>
            )
          )}
          {visibleItems.map((item) => {
            const generation = item.generation;
            const artist = artistFor(generation);
            const isSelected = generation.id === selectedId;
            const isPlaying = player.isActive(generation.id) && player.state.status === "playing";
            const files = parseOutputFiles(generation.output_files);
            const midiFile = findMidiFile(files);
            const midiOnly = Boolean(midiFile) && !findAudioFile(files);
            const savable = generation.status === "done" && Boolean(findAudioFile(files) ?? midiFile);
            const retryable =
              props.mode === "project" && (generation.status === "cancelled" || generation.status === "failed");
            const expanded = expandedId === generation.id;
            const secondary =
              props.mode === "library"
                ? [artist?.name, item.context].filter(Boolean).join(" · ")
                : (generationPrompt(generation) ?? artist?.name ?? "");
            return (
              <li key={generation.id} className="border-b border-ink/[0.07] px-3 last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowClick(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(item);
                    }
                  }}
                  className={`group flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors duration-150 ${
                    isSelected ? "bg-ink/[0.08]" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  <div className="relative shrink-0">
                    <AvatarImage
                      avatarPath={artist?.avatarPath ?? null}
                      name={artist?.name ?? generationTitle(generation)}
                      size={36}
                    />
                    {isPlaying && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${isSelected ? "text-ink" : "text-ink/90"}`}>
                      {generationTitle(generation)}
                    </p>
                    {secondary && <p className="truncate text-[11px] text-ink-muted">{secondary}</p>}
                  </div>
                  <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                    {generationGenres(generation)
                      .slice(0, 2)
                      .map((genre) => (
                        <Chip key={genre}>{genre}</Chip>
                      ))}
                  </div>
                  <div className="hidden w-28 shrink-0 items-center xl:flex">
                    <Chip>
                      {props.mode === "library"
                        ? item.modelDisplayName
                        : (generation.checkpoint_variant ?? item.modelDisplayName)}
                    </Chip>
                  </div>
                  <div className="w-20 shrink-0">
                    <StatusChip status={generation.status} />
                  </div>
                  <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-muted sm:block">
                    {formatRelativeTime(generation.created_at)}
                  </span>
                  {midiOnly && (
                    <span title="Click to view notation">
                      <PianoRollIcon width={14} height={14} className="shrink-0 text-ink-muted" />
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    {retryable ? (
                      <button
                        type="button"
                        onClick={() => project?.onRetry(item)}
                        title="Retry with the same settings"
                        aria-label={`Retry ${generationTitle(generation)}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink"
                      >
                        <RetryIcon width={15} height={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!savable}
                        onClick={() => void handleSave(item)}
                        title="Save a copy"
                        aria-label={`Save ${generationTitle(generation)}`}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink disabled:opacity-30"
                      >
                        <DownloadIcon width={15} height={15} />
                      </button>
                    )}
                    <RowMenu
                      onDetails={() => setExpandedId(expanded ? null : generation.id)}
                      onRetry={retryable ? () => project?.onRetry(item) : undefined}
                      onSave={savable ? () => void handleSave(item) : undefined}
                      onDelete={() => setPendingDelete(item)}
                    />
                  </div>
                </div>
                {saveStatus?.id === generation.id && (
                  <p className="px-3 pb-2 text-[11px] text-ink-muted">{saveStatus.text}</p>
                )}
                <RowAccordion expanded={expanded} item={item} />
              </li>
            );
          })}
        </ul>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${generationTitle(pendingDelete.generation)}"?`}
          description="This removes the track and every file it produced. There's no copy kept anywhere else."
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const item = pendingDelete;
            setPendingDelete(null);
            if (player.isActive(item.generation.id)) player.pause();
            await onDelete(item);
          }}
        />
      )}

      {midiSheetItem && (
        <BottomSheet
          title={generationTitle(midiSheetItem.generation)}
          subtitle="Notation"
          onClose={() => setMidiSheetItem(null)}
        >
          <PianoRollViewer
            filePath={findMidiFile(parseOutputFiles(midiSheetItem.generation.output_files)) ?? ""}
            viewHeight={480}
          />
        </BottomSheet>
      )}
    </GlassPanel>
  );
}

/**
 * The hero's playback surface — whatever this track can actually do right
 * now: the transport for audio, the roll for MIDI-only output, progress
 * while it's still generating.
 */
function HeroPlayback({
  item,
  track,
  queue,
  progressPct,
  onShowLyrics,
}: {
  item: LibraryItem;
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  progressPct: number;
  onShowLyrics: () => void;
}) {
  const generation = item.generation;
  const outputKind = (generation.output_kind ?? "audio") as "audio" | "midi" | "audio+midi";
  const midiFile = findMidiFile(parseOutputFiles(generation.output_files));

  if (generation.status !== "done") {
    const cancellable = generation.status === "queued" || generation.status === "running";
    return (
      <div className="min-w-0 flex-1">
        <OutputViewerPlaceholder
          outputKind={outputKind}
          status={generation.status as GenerationStatus}
          progressPct={progressPct}
          error={generation.error}
          onCancel={cancellable ? () => void kwesiGeneration.cancel(generation.id) : undefined}
        />
      </div>
    );
  }

  if (track) {
    return <TrackControls track={track} queue={queue} lyricsActive={false} onToggleLyrics={onShowLyrics} />;
  }

  // MIDI-only output (MuseCoco, Museformer): there's no transport to show
  // here. A compact roll used to be squeezed into this 84px-tall row, but
  // MuseCoco's real output spans a wide pitch range across several tracks --
  // that many rows crammed into 84px reads as meaningless dashes, not
  // notation. The track row below is the real place to see it now, full
  // size, in its own accordion.
  if (midiFile) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-muted">
        <PianoRollIcon width={16} height={16} className="shrink-0" />
        <span>MIDI output ready — click the track below to view the notation.</span>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <OutputViewerPlaceholder outputKind={outputKind} status="done" />
    </div>
  );
}

function LyricsView({ lyrics }: { lyrics: string | undefined }) {
  return (
    <div className="kwesi-scroll-inset min-h-0 flex-1 overflow-y-auto scroll-smooth px-8 py-6">
      {lyrics ? (
        <pre className="mx-auto max-w-[60ch] whitespace-pre-wrap text-center font-sans text-sm leading-7 text-ink/90">
          {lyrics}
        </pre>
      ) : (
        <p className="flex h-full items-center justify-center text-center text-sm text-ink-muted">
          No lyrics on this track.
        </p>
      )}
    </div>
  );
}

/**
 * Wraps RowDetails in the same CSS grid-template-rows 0fr/1fr animation
 * ModelManager.tsx's accordion rows already use — no JS height measuring,
 * just a transition on the row's own template. RowDetails' content only
 * mounts the first time a row is expanded (not on every render) so a
 * project full of tracks doesn't eagerly fetch/parse every one's MIDI file
 * before the user ever opens it; once opened, it stays mounted so closing
 * and reopening animates instantly.
 */
function RowAccordion({ expanded, item }: { expanded: boolean; item: LibraryItem }) {
  const [everOpened, setEverOpened] = useState(expanded);
  useEffect(() => {
    if (expanded) setEverOpened(true);
  }, [expanded]);

  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-smooth"
      style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">{everOpened && <RowDetails item={item} />}</div>
    </div>
  );
}

function RowDetails({ item }: { item: LibraryItem }) {
  const manifest = getManifest(item.modelId);
  const prompt = generationPrompt(item.generation);
  const files = parseOutputFiles(item.generation.output_files);
  const midiFile = findMidiFile(files);
  const abcFile = findAbcFile(files);
  return (
    <div className="mb-2 flex flex-col gap-4 rounded-[12px] bg-ink/[0.03] px-4 py-4">
      {prompt && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Prompt</p>
          <p className="max-w-[70ch] text-sm leading-relaxed">{prompt}</p>
        </div>
      )}
      {midiFile && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Piano roll</p>
          <PianoRollViewer filePath={midiFile} />
        </div>
      )}
      {abcFile && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Score (ABC notation)</p>
          <AbcScoreViewer filePath={abcFile} />
        </div>
      )}
      <ParamsGrid generation={item.generation} manifest={manifest} />
      {files.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Output files</p>
          <ul className="flex flex-col gap-1">
            {files.map((file) => (
              <li key={file} className="truncate rounded-[8px] bg-ink/[0.04] px-3 py-1.5 text-[11px] text-ink-muted" title={file}>
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.generation.error && <p className="text-xs text-red-600">{item.generation.error}</p>}
    </div>
  );
}

function RowMenu({
  onDetails,
  onRetry,
  onSave,
  onDelete,
}: {
  onDetails: () => void;
  onRetry?: () => void;
  onSave?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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

  const itemClass =
    "w-full rounded-[8px] px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-ink/[0.07]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink"
      >
        <MoreIcon width={16} height={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="kwesi-glass-strong absolute right-0 top-9 z-20 flex w-36 flex-col gap-0.5 rounded-[12px] p-1 shadow-glass"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); onDetails(); }}>
            Details
          </button>
          {onRetry && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); onRetry(); }}>
              Retry
            </button>
          )}
          {onSave && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); onSave(); }}>
              Save a copy
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-red-600 hover:!bg-red-500/10`}
            onClick={() => { setOpen(false); onDelete(); }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
