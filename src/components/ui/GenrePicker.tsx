interface GenrePickerProps {
  options: readonly string[];
  selected: string[];
  onToggle: (genre: string) => void;
}

/** Toggleable chip multi-select — shared between an artist profile's genre
 * set (Settings > Artists, chosen from the full catalog) and a generation's
 * own genre selection (DynamicGenerationForm, chosen from that artist's
 * subset), since both are "pick any number from a fixed list of strings." */
export function GenrePicker({ options, selected, onToggle }: GenrePickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((genre) => {
        const active = selected.includes(genre);
        return (
          <button
            key={genre}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(genre)}
            className={`rounded-chip px-2.5 py-1 text-xs transition-colors duration-150 ${
              active
                ? "bg-accent text-accent-ink"
                : "kwesi-glass text-ink-muted hover:text-ink"
            }`}
          >
            {genre}
          </button>
        );
      })}
    </div>
  );
}
