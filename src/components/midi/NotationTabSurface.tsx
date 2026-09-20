import { useState, type ReactNode } from "react";
import { CopyIcon, ImageCopyIcon, ExpandIcon, CollapseIcon } from "../ui/icons";

interface CopyAction {
  mode: "text" | "image";
  label: string;
  onCopy: () => void | Promise<boolean | void>;
}

interface NotationTabSurfaceProps {
  // Omit both to render without an expand button.
  expanded?: boolean;
  onToggleExpand?: () => void;
  copy?: CopyAction;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  // Explicit pixel height for a context with no bounding flex ancestor (the
  // notation sheet); omit to fill whatever height the caller's className
  // gives this box instead (the hero, via "min-h-0 flex-1" inside its own
  // already-sized flex-col card).
  height?: number;
}

/**
 * Shared chrome for every non-Overview tab (Lyrics, Midi, ABC, Midi.Txt,
 * ABC.Txt): a top-right copy button and, where provided, a bottom-right
 * expand toggle that doubles the content height. The content lives in its
 * own absolutely-positioned, independently-scrolling layer so the buttons
 * stay pinned to this panel's own corners regardless of scroll position --
 * they previously sat at the top/bottom of the *content's own height*, so
 * scrolling long lyrics or a long score carried them off-screen with it.
 */
export function NotationTabSurface({
  expanded,
  onToggleExpand,
  copy,
  children,
  className,
  contentClassName,
  height,
}: NotationTabSurfaceProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!copy) return;
    const result = await copy.onCopy();
    if (result === false) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`relative ${className ?? ""}`} style={height !== undefined ? { height } : undefined}>
      <div className={`kwesi-scroll-inset absolute inset-0 overflow-auto ${contentClassName ?? "p-4"}`}>
        {children}
      </div>
      {copy && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          title={copied ? "Copied" : copy.label}
          aria-label={copy.label}
          className="kwesi-glass absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          {copy.mode === "image" ? <ImageCopyIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
        </button>
      )}
      {onToggleExpand && (
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? "Collapse" : "Expand"}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="kwesi-glass absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          {expanded ? <CollapseIcon width={14} height={14} /> : <ExpandIcon width={14} height={14} />}
        </button>
      )}
    </div>
  );
}
