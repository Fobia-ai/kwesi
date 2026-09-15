import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface SlideOverProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A right-anchored sheet for forms too large for the small centered Modal —
 * full page height, its own scrolling body, closes via the X button, Escape,
 * or clicking the backdrop.
 */
export function SlideOver({ title, subtitle, onClose, children }: SlideOverProps) {
  useEscapeKey(onClose);

  // Portaled to document.body — see Modal.tsx's comment: without this, a
  // backdrop-filter ancestor (any .kwesi-glass panel this gets opened from,
  // e.g. a project's GlassPanel card) traps this fixed overlay inside
  // itself, shrinking it to that card's bounds instead of the viewport.
  return createPortal(
    <div
      className="kwesi-slide-over-backdrop fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kwesi-slide-over-panel kwesi-glass-strong flex h-full w-full max-w-lg flex-col shadow-glass"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink/10 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
