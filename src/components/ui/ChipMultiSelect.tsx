export interface ChipOption {
  value: string;
  label: string;
}

interface ChipMultiSelectProps {
  // A plain string list (the value IS the label — the common case, e.g. the
  // artist genre/language catalogs) or explicit {value,label} pairs for
  // when what's shown and what's actually stored/sent differ (e.g.
  // MuseCoco's genre options, where the label is a friendly name but the
  // value is the server's own token like "pop_rock" or "rnb").
  options: readonly string[] | readonly ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
}

function normalize(options: ChipMultiSelectProps["options"]): ChipOption[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

/** Toggleable chip multi-select — general-purpose "pick any number from a
 * fixed list of options": an artist profile's genre and language sets
 * (Settings > Artists, chosen from the full catalog), a generation's own
 * genre selection scoped to that artist's subset (DynamicGenerationForm),
 * and a model's own fixed-vocabulary genre field (MuseCoco).
 *
 * Height-capped with its own internal scroll rather than left to grow
 * freely: a long catalog (the 51-entry language list is the extreme case)
 * must never be what forces an enclosing Modal past the viewport — the
 * option list scrolls in its own small box instead, so the container
 * around it stays a fixed, predictable size. */
export function ChipMultiSelect({ options, selected, onToggle }: ChipMultiSelectProps) {
  return (
    <div className="kwesi-scroll-inset flex max-h-44 flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
      {normalize(options).map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(option.value)}
            className={`rounded-chip px-2.5 py-1 text-xs transition-colors duration-150 ${
              active
                ? "bg-accent text-accent-ink"
                : "kwesi-glass text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
