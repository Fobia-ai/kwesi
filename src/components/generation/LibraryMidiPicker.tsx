import { useEffect, useState } from "react";
import { kwesiDb, type LibraryGenerationRow } from "../../lib/db";
import { findMidiFile, parseOutputFiles } from "../../lib/audioFiles";
import { generationTitle } from "../library/generationDisplay";
import { PianoRollIcon } from "../ui/icons";

interface LibraryMidiOption {
  filePath: string;
  title: string;
}

// Caps the row rather than listing every MIDI generation ever made -- most
// recent first (listAllGenerations is already sorted that way), plenty for
// a "grab something recent" quick-pick without needing its own scroll/search.
const MAX_SHOWN = 12;

function collectLibraryMidiFiles(rows: LibraryGenerationRow[]): LibraryMidiOption[] {
  const options: LibraryMidiOption[] = [];
  for (const row of rows) {
    if (row.status !== "done") continue;
    const midiFile = findMidiFile(parseOutputFiles(row.output_files));
    if (!midiFile) continue;
    options.push({ filePath: midiFile, title: generationTitle(row) });
    if (options.length >= MAX_SHOWN) break;
  }
  return options;
}

/**
 * Quick-pick pills for any MIDI-output track already in this app's own
 * library -- an alternative to browsing the OS filesystem for a
 * midi_upload field, since the most common source of a "seed" MIDI file is
 * something Kwesi itself already generated (MuseCoco today; whichever
 * other model's output_files include a real .mid tomorrow). Renders
 * nothing while loading or if the library has no MIDI output yet, rather
 * than an empty-state message -- the file input above it is a complete
 * control on its own.
 */
export function LibraryMidiPicker({ value, onSelect }: { value: unknown; onSelect: (filePath: string) => void }) {
  const [options, setOptions] = useState<LibraryMidiOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    kwesiDb.listAllGenerations().then((rows) => {
      if (!cancelled) setOptions(collectLibraryMidiFiles(rows));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!options || options.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px] text-ink-muted">Or pick a MIDI file already in your library:</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = value === opt.filePath;
          return (
            <button
              key={opt.filePath}
              type="button"
              onClick={() => onSelect(opt.filePath)}
              title={opt.filePath}
              className={`flex max-w-[180px] items-center gap-1.5 rounded-chip px-2.5 py-1 text-[11px] transition-colors duration-150 ${
                selected
                  ? "bg-accent/15 text-accent"
                  : "bg-ink/[0.06] text-ink-muted hover:bg-ink/[0.09] hover:text-ink"
              }`}
            >
              <PianoRollIcon width={11} height={11} className="shrink-0" />
              <span className="truncate">{opt.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
