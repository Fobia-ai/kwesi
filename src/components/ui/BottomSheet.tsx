import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassPanel } from "./GlassPanel";
import { CloseIcon } from "./icons";
import { useEscapeKey } from "../../lib/useEscapeKey";

interface BottomSheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Full viewport width, anchored to the bottom, for content that wants real
 * room to breathe (a piano roll) rather than Modal's centered max-w-sm
 * card — content stretches edge to edge and scrolls internally when it
 * doesn't fit, instead of being squeezed into a fixed-width column. Same
 * portal-to-body reasoning as Modal (backdrop-filter ancestors would
 * otherwise clip/mis-size a `position: fixed` overlay) — see Modal.tsx.
 */
export function BottomSheet({ title, subtitle, onClose, children }: BottomSheetProps) {
  useEscapeKey(onClose);
  // Mounts off-screen, then slides up next tick — a plain conditional
  // render has no "before" state for the transition to animate from.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end bg-black/30 backdrop-blur-xl transition-opacity duration-300 ${
        entered ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <GlassPanel
        strong
        className={`flex w-full flex-col overflow-hidden rounded-t-[24px] rounded-b-none transition-transform duration-300 ease-smooth ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.07] hover:text-ink"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className="kwesi-scroll-inset min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </GlassPanel>
    </div>,
    document.body,
  );
}
