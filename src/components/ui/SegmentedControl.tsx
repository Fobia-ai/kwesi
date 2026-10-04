import type { ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * A compact single-choice switch (radio group styled as pills). `value` may
 * be null when nothing matches (e.g. "Custom" settings), leaving all off.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex w-fit flex-wrap gap-0.5 self-start rounded-chip bg-ink/[0.06] p-0.5 text-xs">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-chip px-2.5 py-1 transition-colors ${active ? "bg-bg text-ink shadow-glass-sm" : "text-ink-muted hover:text-ink"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
