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
 * and a model's own fixed-vocabulary genre field (MuseCoco). */
export function ChipMultiSelect({ options, selected, onToggle }: ChipMultiSelectProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
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
