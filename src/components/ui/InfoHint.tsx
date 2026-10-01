import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "./icons";

/**
 * A small (i) icon that opens a hover card explaining a technical term. The
 * card is portaled to <body> and positioned with `position: fixed` from the
 * icon's rect, so it never gets clipped by a scrollable/overflow-hidden
 * ancestor (the training form lives inside an `overflow-y-auto` panel).
 * Opens on hover AND keyboard focus for accessibility.
 */
export function InfoHint({ text, label }: { text: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Keep the 256px card (centered on the icon) fully on-screen with an 8px
    // margin, so icons near a viewport edge don't push it off or over the rail.
    const half = Math.min(128, window.innerWidth * 0.4);
    const center = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ top: r.bottom + 6, left: center });
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ? `About ${label}` : "More info"}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        className="inline-flex shrink-0 cursor-help align-middle text-ink-muted/60 outline-none transition-colors hover:text-accent focus-visible:text-accent"
      >
        <InfoIcon width={13} height={13} />
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
            className="kwesi-glass-strong z-[60] w-64 max-w-[80vw] whitespace-pre-line rounded-[10px] px-3 py-2 text-xs leading-relaxed text-ink shadow-glass"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
